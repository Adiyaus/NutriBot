// ============================================================
// src/services/gemini.js
// Update: tambah estimateNutritionFromText buat fitur /catat
// ============================================================

const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType, data: base64Image } }
                ]
            }]
        });

        return parseNutritionResponse(response.text);

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
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [{ text: prompt }]  // text only, no image
            }]
        });

        return parseNutritionResponse(response.text);

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
async function generateDailyCoaching(user, todaySummary, lastFood) {
    const remaining  = user.daily_calorie_goal - (todaySummary.total_calories || 0);
    const timeOfDay  = getTimeOfDay(); // pagi/siang/sore/malam

    const prompt = `
Kamu adalah coach diet yang friendly, supportif, dan to-the-point. Gaya bahasa lo campuran Indonesia-Inggris (Jaksel style), casual tapi tetap informatif. JANGAN terlalu panjang.

DATA USER:
- Nama: ${user.name}
- Berat: ${user.weight_kg} kg, Target: ${user.target_weight ? user.target_weight + ' kg' : 'belum diset'}
- Target kalori harian: ${Math.round(user.daily_calorie_goal)} kkal
- Waktu sekarang: ${timeOfDay}

MAKANAN YANG BARU DIMAKAN:
- ${lastFood.food_description}
- Kalori: ${lastFood.calories} kkal | Protein: ${lastFood.protein_g}g | Karbo: ${lastFood.carbs_g}g | Lemak: ${lastFood.fat_g}g

PROGRESS HARI INI (setelah makan ini):
- Total kalori: ${Math.round(todaySummary.total_calories)} / ${Math.round(user.daily_calorie_goal)} kkal
- Sisa kalori: ${Math.round(remaining)} kkal
- Sudah makan: ${todaySummary.meal_count}x
- Total protein hari ini: ${(todaySummary.total_protein || 0).toFixed(1)}g

TUGASMU:
Berikan coaching insight yang SINGKAT (max 3 kalimat) dan RELEVAN berdasarkan situasi di atas.
Fokus pada 1 insight terpenting saja — jangan kasih semua sekaligus.
Bisa komentar soal: pilihan makanan, timing makan, sisa kalori, protein intake, atau motivasi.
Kalau user over kalori, tetap supportif — jangan judgmental.
Kalau makanannya sehat/bagus, pujilah dengan tulus.

Balas HANYA teks coaching-nya saja, tanpa formatting markdown, tanpa emoji berlebihan (max 2 emoji).
    `.trim();

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        return response.text.trim();

    } catch (err) {
        console.error('[Gemini] Coaching error:', err.message);
        return null; // return null kalau gagal — handler akan skip coaching
    }
}

/**
 * Generate weekly coaching summary
 * Dipanggil tiap Senin pagi oleh cron job
 *
 * @param {object} user - data profil user
 * @param {Array} weeklyLogs - array food logs 7 hari terakhir
 * @param {number} avgCalories - rata-rata kalori per hari
 * @param {number} daysLogged - berapa hari yang ada log-nya
 * @returns {string} weekly insight dari coach
 */
async function generateWeeklyCoaching(user, weeklyLogs, avgCalories, daysLogged) {
    // Hitung total dan rata-rata nutrisi minggu ini
    const totalProtein = weeklyLogs.reduce((s, l) => s + Number(l.protein_g || 0), 0);
    const avgProtein   = daysLogged > 0 ? (totalProtein / daysLogged).toFixed(1) : 0;
    const caloriesDiff = avgCalories - user.daily_calorie_goal;

    const prompt = `
Kamu adalah coach diet mingguan yang analitis tapi tetap supportif. Gaya bahasa Jaksel, casual, max 5 kalimat.

DATA USER:
- Nama: ${user.name}
- Berat saat ini: ${user.weight_kg} kg
- Target berat: ${user.target_weight ? user.target_weight + ' kg' : 'belum diset'}
- Target kalori harian: ${Math.round(user.daily_calorie_goal)} kkal

RINGKASAN MINGGU INI:
- Hari yang ke-log: ${daysLogged}/7 hari
- Rata-rata kalori/hari: ${Math.round(avgCalories)} kkal
- Selisih dari target: ${caloriesDiff > 0 ? '+' : ''}${Math.round(caloriesDiff)} kkal/hari
- Rata-rata protein/hari: ${avgProtein}g

TUGASMU:
Berikan weekly insight yang mencakup:
1. Evaluasi singkat minggu ini (jujur tapi supportif)
2. 1-2 saran konkret buat minggu depan
3. Kalimat penutup yang motivating

Kalau daysLogged < 4, fokus ke konsistensi dulu.
Kalau avgCalories jauh di atas target, kasih saran praktis.
Kalau sudah bagus, apresiasi dan kasih tantangan kecil.

Balas HANYA teks coaching-nya, tanpa formatting markdown.
    `.trim();

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        return response.text.trim();

    } catch (err) {
        console.error('[Gemini] Weekly coaching error:', err.message);
        return null;
    }
}

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
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        return response.text.trim();

    } catch (err) {
        console.error('[Gemini] CoachAnswer error:', err.message);
        if (err.status === 429 || err.message?.includes('429')) throw new Error('RATE_LIMIT');
        throw new Error('GEMINI_ERROR');
    }
}

module.exports = {
    analyzeFoodImage,
    estimateNutritionFromText,
    generateDailyCoaching,
    generateWeeklyCoaching,
    generateCoachAnswer,
    downloadImage
};