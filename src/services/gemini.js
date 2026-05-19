// ============================================================
// src/services/gemini.js
// Update: tambah estimateSingleFood() — conservative last-resort estimator
//
// CHANGELOG:
//   + estimateSingleFood() → last-resort per-item estimation
//     - prompt lebih konservatif (underestimate daripada overestimate)
//     - output per100g (bukan total) → resolver yang scale
//     - JSON-only, strict schema
//   ~ callGemini() tidak berubah
//   ~ analyzeFoodImage() tidak berubah (tetap identify + portion_g, calories=0)
//   ~ estimateNutritionFromText() tidak berubah (tetap parse items, calories=0)
// ============================================================

const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
require('dotenv').config();

// ─── API KEY ROTATION ─────────────────────────────────────────

function loadApiKeys() {
    const keys = [];
    for (let i = 1; i <= 10; i++) {
        const key = process.env[`GEMINI_API_KEY_${i}`];
        if (key) keys.push(key);
    }
    if (keys.length === 0 && process.env.GEMINI_API_KEY) {
        keys.push(process.env.GEMINI_API_KEY);
    }
    if (keys.length === 0) throw new Error('Tidak ada Gemini API key di .env!');
    console.log(`[Gemini] ${keys.length} API key loaded`);
    return keys;
}

const API_KEYS    = loadApiKeys();
let currentKeyIdx = 0;

function getClient() {
    return new GoogleGenAI({ apiKey: API_KEYS[currentKeyIdx] });
}

function rotateKey() {
    const nextIdx = (currentKeyIdx + 1) % API_KEYS.length;
    if (nextIdx === 0 && currentKeyIdx !== 0) {
        console.warn('[Gemini] Semua API key kena rate limit!');
        currentKeyIdx = 0;
        return false;
    }
    console.log(`[Gemini] Rate limit — rotate ke key ${nextIdx + 1}/${API_KEYS.length}`);
    currentKeyIdx = nextIdx;
    return true;
}

async function callGemini(contents) {
    const triedKeys = new Set();

    while (triedKeys.size < API_KEYS.length) {
        triedKeys.add(currentKeyIdx);

        try {
            const client   = getClient();
            const response = await client.models.generateContent({
                model:    'gemini-2.5-flash-lite',
                contents,
                config: {
                    temperature:      0.1,
                    topP:             0.8,
                    responseMimeType: 'application/json',
                }
            });
            return response.text;

        } catch (err) {
            const errStr = [
                String(err?.message  || ''),
                String(err?.status   || ''),
                String(err?.code     || ''),
                JSON.stringify(err?.errorDetails || ''),
                JSON.stringify(err?.error        || '')
            ].join(' ').toLowerCase();

            const isRateLimit =
                err?.status === 429                    ||
                err?.status === 'RESOURCE_EXHAUSTED'  ||
                errStr.includes('429')                ||
                errStr.includes('resource_exhausted') ||
                errStr.includes('quota')              ||
                errStr.includes('rate_limit')         ||
                errStr.includes('rate limit');

            if (isRateLimit) {
                console.log(`[Gemini] Key ${currentKeyIdx + 1} rate limit — rotate...`);
                const hasMore = rotateKey();
                if (!hasMore || triedKeys.has(currentKeyIdx)) {
                    console.warn('[Gemini] Semua key exhausted!');
                    throw new Error('RATE_LIMIT');
                }
                continue;
            }

            if (errStr.includes('safety'))        throw new Error('SAFETY_BLOCK');
            if (err.message === 'PARSE_ERROR')    throw new Error('PARSE_ERROR');
            console.error('[Gemini] Non-rate-limit error:', err.message || err);
            throw new Error('GEMINI_ERROR');
        }
    }
    throw new Error('RATE_LIMIT');
}

// ─── DOWNLOAD IMAGE ───────────────────────────────────────────

async function downloadImage(fileUrl) {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}

// ─── ANALISIS DARI FOTO ───────────────────────────────────────
// TIDAK BERUBAH — masih identify + portion_g, kalori diisi 0 (resolver yang isi)

async function analyzeFoodImage(imageBuffer, mimeType = 'image/jpeg', userContext = '') {
    const contextLine = userContext
        ? `\nINFO TAMBAHAN DARI USER: "${userContext}" — prioritaskan info ini`
        : '';

    const prompt = `
Kamu adalah food identifier. Tugasmu HANYA: identifikasi makanan dan estimasi BERAT FISIK (gram) tiap komponen.
Kalori akan dihitung dari database eksternal — jangan estimasi kalori sendiri.

STANDAR BERAT REFERENSI:
- Nasi putih: 1 centong = 100g, 1 piring = 200g, 1 mangkok = 250g
- Ayam goreng: 1 potong paha = 80g, dada = 100g
- Mie instan: 1 bungkus kering = 85g
- Roti tawar: 1 lembar = 30g
- Telur: 1 butir = 55g
- Tempe: 1 potong 5cm = 30g, 1 papan = 250g
- Tahu: 1 potong sedang = 80g
- Sayuran tumis: 1 porsi = 50-80g${contextLine}

ATURAN:
- Kalau BUKAN makanan/minuman → set is_food: false
- Pisahkan tiap komponen dalam food_items
- Nama di food_items WAJIB bahasa Inggris (untuk database lookup)
- Berat harus angka spesifik — bukan range
- Set calories/protein_g/carbs_g/fat_g ke 0 — ini diisi dari database

Balas HANYA JSON ini (tidak ada teks lain):
{
  "is_food": true,
  "food_description": "deskripsi dalam bahasa Indonesia",
  "food_items": [
    {"name": "steamed white rice", "portion_g": 200},
    {"name": "fried chicken thigh", "portion_g": 80}
  ],
  "calories": 0,
  "protein_g": 0,
  "carbs_g": 0,
  "fat_g": 0,
  "confidence": "high",
  "notes": "asumsi ukuran yang dipakai"
}
    `.trim();

    try {
        const base64Image = imageBuffer.toString('base64');
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

// ─── ESTIMASI DARI TEKS ───────────────────────────────────────
// TIDAK BERUBAH — masih parse items + portion_g, kalori diisi 0

async function estimateNutritionFromText(foodText) {
    const prompt = `
Kamu adalah food parser. Tugasmu HANYA: parse deskripsi makanan → komponen + berat gram.
Kalori akan dihitung dari database eksternal — jangan estimasi kalori sendiri.

STANDAR BERAT REFERENSI:
- Nasi putih: 1 centong = 100g, 1 piring = 200g, 1 mangkok = 250g
- Ayam goreng: 1 potong paha = 80g, dada = 100g
- Mie instan: 1 bungkus kering = 85g
- Roti tawar: 1 lembar = 30g
- Telur: 1 butir = 55g
- Tempe: 1 potong 5cm = 30g, 1 papan = 250g
- Tahu: 1 potong sedang = 80g
- Sayuran: 1 porsi = 50-80g

User input: "${foodText}"

ATURAN:
- Kalau bukan makanan → is_food: false
- Pisahkan tiap komponen dalam food_items, nama WAJIB bahasa Inggris
- Kalau ada berat/ukuran eksplisit dari user, pakai itu
- Kalau tidak ada ukuran, pakai standar referensi di atas
- Set calories/protein_g/carbs_g/fat_g ke 0

Balas HANYA JSON (tidak ada teks lain):
{
  "is_food": true,
  "food_description": "deskripsi + porsi, bahasa Indonesia",
  "food_items": [
    {"name": "steamed white rice", "portion_g": 200},
    {"name": "fried egg", "portion_g": 55}
  ],
  "calories": 0,
  "protein_g": 0,
  "carbs_g": 0,
  "fat_g": 0,
  "confidence": "high",
  "notes": "asumsi ukuran tiap komponen"
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

// ─── ESTIMASI SINGLE FOOD — LAST RESORT (NEW) ────────────────

/**
 * Estimasi nutrisi PER 100G untuk satu jenis makanan
 * Dipanggil HANYA kalau semua sumber lain (cache, dataset, USDA, OFF) gagal
 *
 * Prinsip konservatif:
 *   - Gunakan angka standar dari literatur gizi (TKPI / USDA average)
 *   - Bila ragu, ambil angka LEBIH RENDAH (underestimate > overestimate)
 *   - Jangan kreatif dengan perkiraan — stick to reference ranges
 *   - Return per100g, bukan total portion (resolver yang scale)
 *
 * @param {string} foodName  - nama makanan (English/Indonesia)
 * @param {number} portionG  - besar porsi dalam gram (untuk konteks saja, output tetap per100g)
 * @returns {{ calories_per100g, protein_per100g, carbs_per100g, fat_per100g, food_name }}
 */
async function estimateSingleFood(foodName, portionG = 100) {
    const prompt = `
Kamu adalah database nutrisi fallback. Tugasmu: estimasi nilai nutrisi PER 100 GRAM untuk makanan berikut.

MAKANAN: "${foodName}"
(Konteks porsi user: ~${portionG}g — tapi output harus per 100g)

PRINSIP PENTING:
1. Gunakan angka dari referensi standar: TKPI (Indonesia), USDA, atau tabel gizi resmi
2. Bila ragu antara dua angka, pilih yang LEBIH RENDAH — underestimate lebih aman
3. Jangan kreatif atau spekulatif — hanya gunakan range yang masuk akal untuk jenis makanan ini
4. Kalau makanan tidak dikenal sama sekali, estimasi dari kategori terdekat

RANGE REFERENSI UMUM (per 100g):
- Nasi/karbohidrat olahan: 130-200 kcal
- Lauk goreng (ayam/ikan): 180-300 kcal
- Lauk kukus/rebus: 100-180 kcal
- Sayuran (tumis/rebus): 30-80 kcal
- Gorengan/jajanan: 200-350 kcal
- Buah-buahan: 40-100 kcal
- Daging merah (matang): 150-250 kcal

Balas HANYA JSON ini, tidak ada teks lain:
{
  "food_name": "nama standar makanan ini",
  "calories_per100g": 130,
  "protein_per100g": 2.7,
  "carbs_per100g": 28.6,
  "fat_per100g": 0.3,
  "confidence": "low",
  "reference": "sumber referensi yang digunakan (contoh: TKPI 2017, USDA estimate)"
}

PENTING: confidence SELALU "low" karena ini estimasi AI, bukan data database resmi.
    `.trim();

    try {
        const rawText = await callGemini([{
            role: 'user',
            parts: [{ text: prompt }]
        }]);

        // Parse JSON
        const cleaned = rawText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        let parsed;
        try {
            parsed = JSON.parse(cleaned);
        } catch {
            console.error('[Gemini] estimateSingleFood parse error:', cleaned);
            return null;
        }

        // Validasi: kalori harus masuk akal (5–900 kcal per 100g)
        const cal = Number(parsed.calories_per100g);
        if (!cal || cal < 5 || cal > 900) {
            console.warn(`[Gemini] estimateSingleFood: kalori tidak valid (${cal}) untuk "${foodName}"`);
            return null;
        }

        return {
            food_name:        parsed.food_name     || foodName,
            calories_per100g: Math.round(cal),
            protein_per100g:  Math.max(0, parseFloat((Number(parsed.protein_per100g) || 0).toFixed(1))),
            carbs_per100g:    Math.max(0, parseFloat((Number(parsed.carbs_per100g)   || 0).toFixed(1))),
            fat_per100g:      Math.max(0, parseFloat((Number(parsed.fat_per100g)     || 0).toFixed(1))),
            confidence:       'low', // paksa low — jangan percaya override dari Gemini
        };

    } catch (err) {
        console.error('[Gemini] estimateSingleFood error:', err.message);
        return null; // return null — resolver akan treat sebagai failed item
    }
}

// ─── COACH ANSWER ─────────────────────────────────────────────
// TIDAK BERUBAH

async function generateCoachAnswer(user, todaySummary, question, history = []) {
    const consumed  = Math.round(todaySummary?.total_calories || 0);
    const remaining = Math.round((user.daily_calorie_goal || 0) - consumed);
    const heightM   = user.height_cm / 100;
    const bmi       = (user.weight_kg / (heightM * heightM)).toFixed(1);

    const systemPrompt = `
Kamu adalah coach diet & nutrisi profesional bernama Coach NutriBot.
Lo friendly, evidence-based, dan gaya bahasa lo campuran Indonesia-Inggris (Jaksel style).
Jawaban lo harus PERSONAL — selalu kaitkan dengan kondisi spesifik user ini.
PENTING: Lo punya memori percakapan — kalau user nanya lanjutan, gunakan konteks sebelumnya.

DATA LENGKAP USER:
- Nama: ${user.name}
- Umur: ${user.age} tahun, Gender: ${user.gender}
- Tinggi: ${user.height_cm} cm, Berat: ${user.weight_kg} kg, BMI: ${bmi}
- Level aktivitas: ${user.activity_level}
- BMR: ${Math.round(user.bmr)} kkal, TDEE: ${Math.round(user.tdee)} kkal
- Target kalori: ${Math.round(user.daily_calorie_goal)} kkal/hari
- Target berat: ${user.target_weight ? user.target_weight + ' kg' : 'belum diset'}

PROGRESS HARI INI:
- Kalori terpakai: ${consumed} kkal, Sisa: ${remaining} kkal
- Sudah makan: ${todaySummary?.meal_count || 0}x

ATURAN JAWABAN:
- Jawab langsung, to-the-point, max 5-7 kalimat
- Gunakan angka spesifik dari data user
- Kalau di luar topik diet/nutrisi/olahraga, tolak dengan sopan

Balas HANYA teks jawabannya saja.
    `.trim();

    const contents = [
        { role: 'user',  parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Siap! Gua Coach NutriBot, tanya aja soal diet & nutrisi lo.' }] },
        ...history.map(msg => ({
            role:  msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        })),
        { role: 'user', parts: [{ text: question }] }
    ];

    try {
        const rawText = await callGemini(contents);
        return rawText.trim();
    } catch (err) {
        console.error('[Gemini] CoachAnswer error:', err.message);
        if (err.message === 'RATE_LIMIT') throw new Error('RATE_LIMIT');
        throw new Error('GEMINI_ERROR');
    }
}

// ─── SHARED HELPERS ───────────────────────────────────────────

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
        food_items:       Array.isArray(parsed.food_items) ? parsed.food_items : [],
        calories:         Math.max(0, Math.round(Number(parsed.calories)  || 0)),
        protein_g:        Math.max(0, parseFloat((Number(parsed.protein_g) || 0).toFixed(1))),
        carbs_g:          Math.max(0, parseFloat((Number(parsed.carbs_g)   || 0).toFixed(1))),
        fat_g:            Math.max(0, parseFloat((Number(parsed.fat_g)     || 0).toFixed(1))),
        confidence:       parsed.confidence || 'medium',
        notes:            parsed.notes || '',
        gemini_raw:       rawText
    };
}

function handleGeminiError(err) {
    if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota')) {
        throw new Error('RATE_LIMIT');
    }
    if (err.message?.includes('SAFETY'))  throw new Error('SAFETY_BLOCK');
    if (err.message === 'PARSE_ERROR')    throw new Error('PARSE_ERROR');
    console.error('[Gemini] Unexpected error:', err.message);
    throw new Error('GEMINI_ERROR');
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    analyzeFoodImage,
    estimateNutritionFromText,
    estimateSingleFood,      // NEW — last-resort per-item estimator
    generateCoachAnswer,
    downloadImage,
};