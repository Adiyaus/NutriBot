// ============================================================
// src/services/gemini.js
// Update: multi API key rotation — otomatis pindah key kalau rate limit
// ============================================================

const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
require('dotenv').config();

// ─── API KEY ROTATION SETUP ───────────────────────────────────

/**
 * Kumpulkan semua API key dari .env
 * Support format: GEMINI_API_KEY_1, GEMINI_API_KEY_2, dst
 * Fallback ke GEMINI_API_KEY kalau format lama masih dipakai
 */
function loadApiKeys() {
    const keys = [];

    // Coba baca GEMINI_API_KEY_1, _2, _3, ... sampai _10
    for (let i = 1; i <= 10; i++) {
        const key = process.env[`GEMINI_API_KEY_${i}`];
        if (key) keys.push(key);
    }

    // Fallback: kalau gak ada format numbered, pakai GEMINI_API_KEY biasa
    if (keys.length === 0 && process.env.GEMINI_API_KEY) {
        keys.push(process.env.GEMINI_API_KEY);
    }

    if (keys.length === 0) {
        throw new Error('Tidak ada Gemini API key ditemukan di .env!');
    }

    console.log(`[Gemini] ${keys.length} API key loaded`);
    return keys;
}

const API_KEYS     = loadApiKeys();
let currentKeyIdx  = 0; // index key yang sedang aktif

/**
 * Ambil Gemini client yang aktif sekarang
 */
function getClient() {
    return new GoogleGenAI({ apiKey: API_KEYS[currentKeyIdx] });
}

/**
 * Rotate ke key berikutnya
 * Dipanggil otomatis kalau kena rate limit
 * @returns {boolean} true kalau masih ada key lain, false kalau semua sudah dicoba
 */
function rotateKey() {
    const nextIdx = (currentKeyIdx + 1) % API_KEYS.length;

    // Kalau udah balik ke key pertama = semua key sudah dicoba
    if (nextIdx === 0 && currentKeyIdx !== 0) {
        console.warn('[Gemini] Semua API key kena rate limit!');
        currentKeyIdx = 0; // reset ke awal buat request berikutnya
        return false;
    }

    console.log(`[Gemini] Rate limit — rotate ke key ${nextIdx + 1}/${API_KEYS.length}`);
    currentKeyIdx = nextIdx;
    return true;
}

/**
 * Wrapper utama: panggil Gemini dengan auto-retry ke key berikutnya kalau rate limit
 * Semua fungsi di bawah pakai ini — DRY & konsisten
 *
 * @param {Array} contents - Gemini contents array
 * @returns {string} response text dari Gemini
 */
async function callGemini(contents) {
    const triedKeys = new Set(); // track key yang sudah dicoba

    while (triedKeys.size < API_KEYS.length) {
        triedKeys.add(currentKeyIdx);

        try {
            const client   = getClient();
            const response = await client.models.generateContent({
                model: 'gemini-2.5-flash',
                contents
            });
            return response.text; // sukses → return langsung

        } catch (err) {
            const isRateLimit = err.status === 429
                || err.message?.includes('429')
                || err.message?.includes('quota')
                || err.message?.includes('RATE_LIMIT');

            if (isRateLimit) {
                // Coba rotate ke key berikutnya
                const hasMore = rotateKey();

                if (!hasMore || triedKeys.has(currentKeyIdx)) {
                    // Semua key sudah dicoba dan kena rate limit semua
                    throw new Error('RATE_LIMIT');
                }
                // Lanjut loop — coba dengan key baru
                continue;
            }

            // Error bukan rate limit — langsung throw
            if (err.message?.includes('SAFETY'))  throw new Error('SAFETY_BLOCK');
            if (err.message === 'PARSE_ERROR')     throw new Error('PARSE_ERROR');
            console.error('[Gemini] Error:', err.message);
            throw new Error('GEMINI_ERROR');
        }
    }

    throw new Error('RATE_LIMIT'); // fallback kalau somehow keluar loop
}

// ─── DOWNLOAD IMAGE ───────────────────────────────────────────

async function downloadImage(fileUrl) {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}

// ─── ANALISIS DARI FOTO ───────────────────────────────────────

async function analyzeFoodImage(imageBuffer, mimeType = 'image/jpeg') {
    const prompt = `
Kamu adalah ahli nutrisi profesional. Analisis gambar makanan ini secara detail.

ATURAN:
- Kalau BUKAN makanan/minuman, set is_food: false dan semua angka ke 0
- Identifikasi semua item makanan yang terlihat
- Estimasi porsi berdasarkan visual (piring standar, mangkok biasa, dll)
- Berikan estimasi nutrisi yang REALISTIS berdasarkan porsi tersebut
- Untuk makanan Indonesia, gunakan referensi porsi umum Indonesia

Balas HANYA JSON ini (tanpa markdown, tanpa teks lain):
{
  "is_food": true,
  "food_description": "deskripsi makanan dalam bahasa Indonesia, pisah dengan koma",
  "calories": angka_kalori_integer,
  "protein_g": angka_protein_satu_desimal,
  "carbs_g": angka_karbo_satu_desimal,
  "fat_g": angka_lemak_satu_desimal,
  "confidence": "high/medium/low",
  "notes": "catatan singkat estimasi porsi kalau perlu"
}
    `.trim();

    try {
        const base64Image = imageBuffer.toString('base64');

        // Pakai callGemini wrapper — auto rotate key kalau rate limit
        const rawText = await callGemini([{
            role: 'user',
            parts: [
                { text: prompt },
                { inlineData: { mimeType, data: base64Image } }
            ]
        }]);

        return parseNutritionResponse(rawText);

    } catch (err) {
        handleGeminiError(err);
    }
}

// ─── ESTIMASI DARI TEKS (BARU) ────────────────────────────────

/**
 * Estimasi nutrisi dari deskripsi teks makanan
 * Dipake buat fitur /catat — user ketik manual makanannya
 *
 * @param {string} foodText - deskripsi makanan dari user
 *   contoh: "nasi goreng 1 porsi, telur mata sapi 2 butir"
 * @returns {object} { is_food, food_description, calories, protein_g, carbs_g, fat_g, confidence }
 */
async function estimateNutritionFromText(foodText) {
    const prompt = `
Kamu adalah ahli nutrisi profesional yang hafal kandungan gizi berbagai makanan.

User makan: "${foodText}"

TUGASMU:
- Estimasi kandungan nutrisi makanan yang disebutkan
- Kalau porsi tidak disebutkan, gunakan porsi standar Indonesia
- Kalau bukan makanan/minuman sama sekali, set is_food: false
- Untuk makanan kemasan (indomie, pocari, dll), gunakan data nutrisi yang akurat
- Gabungkan semua item jadi total keseluruhan

Balas HANYA JSON ini (tanpa markdown, tanpa teks lain):
{
  "is_food": true,
  "food_description": "deskripsi lengkap + porsi yang diasumsikan, pisah koma",
  "calories": angka_kalori_integer,
  "protein_g": angka_protein_satu_desimal,
  "carbs_g": angka_karbo_satu_desimal,
  "fat_g": angka_lemak_satu_desimal,
  "confidence": "high/medium/low",
  "notes": "asumsi porsi yang dipakai kalau user tidak specify"
}
    `.trim();

    try {
        const rawText = await callGemini([{
            role: 'user',
            parts: [{ text: prompt }]
        }]);

        return parseNutritionResponse(rawText);

    } catch (err) {
        handleGeminiError(err);
    }
}

// ─── SHARED HELPERS ───────────────────────────────────────────

/**
 * Parse dan validasi JSON response dari Gemini
 * Dipake oleh kedua fungsi di atas biar DRY
 */
function parseNutritionResponse(rawText) {
    const cleaned = rawText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        console.error('[Gemini] Parse error:', cleaned);
        throw new Error('PARSE_ERROR');
    }

    if (!parsed.is_food) {
        return {
            is_food: false,
            food_description: '', calories: 0,
            protein_g: 0, carbs_g: 0, fat_g: 0,
            confidence: 'low', notes: ''
        };
    }

    return {
        is_food:          true,
        food_description: parsed.food_description || 'Makanan tidak teridentifikasi',
        calories:         Math.max(0, Math.round(Number(parsed.calories)  || 0)),
        protein_g:        Math.max(0, parseFloat((Number(parsed.protein_g) || 0).toFixed(1))),
        carbs_g:          Math.max(0, parseFloat((Number(parsed.carbs_g)   || 0).toFixed(1))),
        fat_g:            Math.max(0, parseFloat((Number(parsed.fat_g)     || 0).toFixed(1))),
        confidence:       parsed.confidence || 'medium',
        notes:            parsed.notes || '',
        gemini_raw:       rawText
    };
}

/**
 * Handle error dari Gemini API secara konsisten
 */
function handleGeminiError(err) {
    if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota')) {
        throw new Error('RATE_LIMIT');
    }
    if (err.message?.includes('SAFETY'))  throw new Error('SAFETY_BLOCK');
    if (err.message === 'PARSE_ERROR')    throw new Error('PARSE_ERROR');
    console.error('[Gemini] Unexpected error:', err.message);
    throw new Error('GEMINI_ERROR');
}

// ─── DAILY COACHING ───────────────────────────────────────────

/**
 * Generate coaching insight setelah user log makan
 * Dipanggil setiap habis foto atau /catat
 *
 * @param {object} user - data profil user dari DB
 * @param {object} todaySummary - total nutrisi hari ini (sudah include log terbaru)
 * @param {object} lastFood - makanan yang baru saja di-log
 * @returns {string} pesan coaching singkat dari "coach"
 */

// ─── HELPER ───────────────────────────────────────────────────

function getTimeOfDay() {
    // Jam WIB (UTC+7)
    const wibHour = (new Date().getUTCHours() + 7) % 24;
    if (wibHour >= 5  && wibHour < 11) return 'pagi';
    if (wibHour >= 11 && wibHour < 15) return 'siang';
    if (wibHour >= 15 && wibHour < 18) return 'sore';
    return 'malam';
}

/**
 * Jawab pertanyaan user seputar diet, nutrisi, olahraga
 * Dipersonalisasi berdasarkan data profil user
 *
 * @param {object} user - profil user dari DB
 * @param {object} todaySummary - progress kalori hari ini
 * @param {string} question - pertanyaan dari user
 * @returns {string} jawaban dari coach
 */
async function generateCoachAnswer(user, todaySummary, question) {
    const consumed  = Math.round(todaySummary?.total_calories || 0);
    const remaining = Math.round((user.daily_calorie_goal || 0) - consumed);

    // Hitung BMI realtime dari data user
    const heightM = user.height_cm / 100;
    const bmi     = (user.weight_kg / (heightM * heightM)).toFixed(1);

    const prompt = `
Kamu adalah coach diet & nutrisi profesional bernama Coach NutriBot. 
Lo friendly, evidence-based, dan gaya bahasa lo campuran Indonesia-Inggris (Jaksel style).
Jawaban lo harus PERSONAL — selalu kaitkan dengan kondisi spesifik user ini.

DATA LENGKAP USER:
- Nama: ${user.name}
- Umur: ${user.age} tahun
- Gender: ${user.gender}
- Tinggi: ${user.height_cm} cm
- Berat: ${user.weight_kg} kg
- BMI: ${bmi}
- Level aktivitas: ${user.activity_level}
- BMR: ${Math.round(user.bmr)} kkal/hari
- TDEE: ${Math.round(user.tdee)} kkal/hari
- Target kalori: ${Math.round(user.daily_calorie_goal)} kkal/hari
- Target berat: ${user.target_weight ? user.target_weight + ' kg' : 'belum diset'}

PROGRESS HARI INI:
- Kalori terpakai: ${consumed} kkal
- Sisa kalori: ${remaining} kkal
- Sudah makan: ${todaySummary?.meal_count || 0}x

PERTANYAAN USER:
"${question}"

ATURAN JAWABAN:
- Jawab langsung, to-the-point, max 5-7 kalimat
- Selalu personalisasi dengan data user di atas — jangan jawab generik
- Kalau pertanyaan soal olahraga, sesuaikan dengan berat badan & level aktivitas user
- Kalau pertanyaan soal makanan/nutrisi, kaitkan dengan target kalori user
- Kalau pertanyaan di luar topik diet/nutrisi/olahraga/kesehatan, tolak dengan sopan
- Boleh kasih 1-2 saran konkret yang actionable
- Gunakan angka spesifik dari data user kalau relevan

Balas HANYA teks jawabannya saja, tanpa label atau prefix apapun.
    `.trim();

    try {
        const rawText = await callGemini([{
            role: 'user', parts: [{ text: prompt }]
        }]);
        return rawText.trim();

    } catch (err) {
        console.error('[Gemini] CoachAnswer error:', err.message);
        if (err.message === 'RATE_LIMIT') throw new Error('RATE_LIMIT');
        throw new Error('GEMINI_ERROR');
    }
}

/**
 * Generate rekomendasi makanan berikutnya
 * Dipanggil setelah user log makan (foto atau /catat)
 *
 * @param {object} user - profil user
 * @param {object} todaySummary - total nutrisi hari ini (sudah include log terbaru)
 * @param {object} lastFood - makanan yang baru saja di-log
 * @returns {string} rekomendasi makanan dalam format teks
 */
async function generateFoodRecommendation(user, todaySummary, lastFood) {
    const remaining     = user.daily_calorie_goal - (todaySummary.total_calories || 0);
    const remainingProt = Math.max(0, 100 - (todaySummary.total_protein || 0)); // estimasi kebutuhan protein ~100g
    const mealCount     = todaySummary.meal_count || 1;
    const timeOfDay     = getTimeOfDay();

    // Kalau kalori udah habis atau over, skip rekomendasi
    if (remaining <= 50) return null;

    const prompt = `
Kamu adalah ahli gizi yang kasih rekomendasi makanan praktis dan realistis.
Gaya bahasa Jaksel, singkat dan actionable. Fokus ke makanan yang MUDAH DIDAPAT di Indonesia.

DATA USER:
- Berat: ${user.weight_kg} kg | Target: ${user.target_weight ? user.target_weight + ' kg' : 'belum diset'}
- Sisa kalori hari ini: ${Math.round(remaining)} kkal
- Sisa protein yang dibutuhkan: ~${Math.round(remainingProt)}g
- Udah makan: ${mealCount}x hari ini
- Waktu sekarang: ${timeOfDay}
- Makanan terakhir: ${lastFood.food_description} (${lastFood.calories} kkal)

TUGASMU:
Rekomendasikan 2-3 pilihan makanan untuk makan berikutnya yang:
1. Kalorinya sesuai dengan sisa budget (${Math.round(remaining)} kkal)
2. Bantu penuhi kebutuhan nutrisi yang masih kurang
3. Sesuai waktu (${timeOfDay}) dan mudah didapat di Indonesia
4. Variatif — jangan rekomendasiin makanan yang sama dengan yang baru dimakan

Format jawaban WAJIB seperti ini (tanpa teks tambahan):
🍽️ *Rekomendasi Makan ${timeOfDay.charAt(0).toUpperCase() + timeOfDay.slice(1)} Berikutnya:*

1. [nama makanan] (~[kalori] kkal)
   _[alasan singkat 1 kalimat kenapa ini bagus]_

2. [nama makanan] (~[kalori] kkal)
   _[alasan singkat]_

3. [nama makanan] (~[kalori] kkal)
   _[alasan singkat]_
    `.trim();

    try {
        const rawText = await callGemini([{
            role: 'user', parts: [{ text: prompt }]
        }]);
        return rawText.trim();

    } catch (err) {
        console.error('[Gemini] FoodRec error:', err.message);
        return null; // silent fail — jangan ganggu UX
    }
}

module.exports = {
    analyzeFoodImage,
    estimateNutritionFromText,
    generateFoodRecommendation,
    generateCoachAnswer,
    downloadImage
};