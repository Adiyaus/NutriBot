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
                model: 'gemini-2.5-flash-lite',
                contents,
                config: {
                    temperature:     0.1,  // rendah = lebih deterministik, kurangi variasi
                    topP:            0.8,
                    responseMimeType: 'application/json',  // paksa output JSON murni
                }
            });
            return response.text; // sukses → return langsung

        } catch (err) {
            // Stringify semua property error biar gak ada yang kelewat
            // SDK baru @google/genai pakai "RESOURCE_EXHAUSTED" bukan status 429
            const errStr = [
                String(err?.message  || ''),
                String(err?.status   || ''),
                String(err?.code     || ''),
                JSON.stringify(err?.errorDetails || ''),
                JSON.stringify(err?.error        || '')
            ].join(' ').toLowerCase();

            const isRateLimit =
                err?.status === 429                        ||
                err?.status === 'RESOURCE_EXHAUSTED'      || // SDK baru
                errStr.includes('429')                    ||
                errStr.includes('resource_exhausted')     || // key error message
                errStr.includes('quota')                  ||
                errStr.includes('rate_limit')             ||
                errStr.includes('rate limit');

            if (isRateLimit) {
                console.log(`[Gemini] Key ${currentKeyIdx + 1} rate limit — rotate...`);

                const hasMore = rotateKey();

                if (!hasMore || triedKeys.has(currentKeyIdx)) {
                    console.warn('[Gemini] Semua key exhausted!');
                    throw new Error('RATE_LIMIT');
                }
                continue; // coba key berikutnya
            }

            // Error bukan rate limit
            if (errStr.includes('safety'))         throw new Error('SAFETY_BLOCK');
            if (err.message === 'PARSE_ERROR')     throw new Error('PARSE_ERROR');
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

async function analyzeFoodImage(imageBuffer, mimeType = 'image/jpeg', userContext = '') {
    // Kalau user kasih konteks, masukin ke prompt biar Gemini lebih akurat
    const contextLine = userContext
        ? `\nINFO TAMBAHAN DARI USER: "${userContext}" — prioritaskan info ini untuk identifikasi makanan`
        : '';

    const prompt = `
Kamu adalah database nutrisi. Tugasmu: identifikasi makanan dan estimasi BERAT FISIK (gram) tiap komponen.
Kalori akan dihitung dari database eksternal — fokus lo HANYA pada identifikasi dan estimasi berat yang akurat.

STANDAR REFERENSI BERAT (gunakan ini sebagai acuan konsisten):
- Nasi putih 1 centong = 100g, 1 piring = 200g, 1 mangkok = 250g
- Ayam goreng 1 potong paha = 80g, dada = 100g
- Mie instan 1 bungkus = 85g (kering)
- Roti tawar 1 lembar = 30g
- Telur 1 butir = 55g
- Tempe 1 potong persegi 5cm = 30g, 1 papan = 250g
- Tahu 1 potong sedang = 80g
- Sayuran tumis 1 porsi = 50g
- Sambal/saus 1 sendok = 15g

ATURAN:
- Kalau BUKAN makanan/minuman, set is_food: false
- Sebutkan TIAP komponen secara terpisah dalam food_items (nasi, lauk, sayur — dipisah)
- Nama di food_items WAJIB bahasa Inggris (untuk database lookup)
- Estimasi berat harus SPESIFIK angka, bukan range${contextLine}

Balas HANYA JSON ini:
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
  "confidence": "high/medium/low",
  "notes": "referensi ukuran yang dipakai (contoh: nasi 1 piring = 200g)"
}

PENTING: Set calories/protein_g/carbs_g/fat_g ke 0 — nilai ini akan diambil dari database, bukan estimasi lo.
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
Kamu adalah database nutrisi. Tugasmu: parse deskripsi makanan menjadi komponen + berat gram yang akurat.
Kalori akan dihitung dari database eksternal — fokus lo HANYA pada identifikasi dan estimasi berat.

STANDAR REFERENSI BERAT (gunakan ini sebagai acuan konsisten):
- Nasi putih 1 centong = 100g, 1 piring = 200g, 1 mangkok = 250g
- Ayam goreng 1 potong paha = 80g, dada = 100g
- Mie instan 1 bungkus = 85g (kering)
- Roti tawar 1 lembar = 30g
- Telur 1 butir = 55g
- Tempe 1 potong persegi 5cm = 30g, 1 papan = 250g
- Tahu 1 potong sedang = 80g
- Sayuran tumis 1 porsi = 50g

User makan: "${foodText}"

ATURAN:
- Kalau bukan makanan sama sekali, set is_food: false
- Pisahkan tiap komponen dalam food_items, nama WAJIB bahasa Inggris
- Kalau ada berat/ukuran eksplisit dari user, pakai itu — jangan ubah
- Kalau tidak ada ukuran, pakai standar referensi di atas
- Set calories/protein_g/carbs_g/fat_g ke 0 (akan dihitung dari database)

Balas HANYA JSON ini:
{
  "is_food": true,
  "food_description": "deskripsi + porsi yang dipakai, dalam bahasa Indonesia",
  "food_items": [
    {"name": "steamed white rice", "portion_g": 200},
    {"name": "fried egg", "portion_g": 55}
  ],
  "calories": 0,
  "protein_g": 0,
  "carbs_g": 0,
  "fat_g": 0,
  "confidence": "high/medium/low",
  "notes": "ukuran yang diasumsikan untuk tiap komponen"
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
        food_items:       Array.isArray(parsed.food_items) ? parsed.food_items : [], // ← buat USDA lookup
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

/**
 * Jawab pertanyaan user seputar diet, nutrisi, olahraga
 * Dipersonalisasi berdasarkan data profil user
 *
 * @param {object} user - profil user dari DB
 * @param {object} todaySummary - progress kalori hari ini
 * @param {string} question - pertanyaan dari user
 * @returns {string} jawaban dari coach
 */
/**
 * Jawab pertanyaan user dengan memory percakapan
 *
 * @param {object} user         - profil user dari DB
 * @param {object} todaySummary - progress kalori hari ini
 * @param {string} question     - pertanyaan terbaru dari user
 * @param {Array}  history      - array { role: 'user'|'assistant', content: string }
 * @returns {string} jawaban dari coach
 */
async function generateCoachAnswer(user, todaySummary, question, history = []) {
    const consumed  = Math.round(todaySummary?.total_calories || 0);
    const remaining = Math.round((user.daily_calorie_goal || 0) - consumed);
    const heightM   = user.height_cm / 100;
    const bmi       = (user.weight_kg / (heightM * heightM)).toFixed(1);

    // System prompt sebagai pesan pertama — kasih konteks profil user
    const systemPrompt = `
Kamu adalah coach diet & nutrisi profesional bernama Coach NutriBot. 
Lo friendly, evidence-based, dan gaya bahasa lo campuran Indonesia-Inggris (Jaksel style).
Jawaban lo harus PERSONAL — selalu kaitkan dengan kondisi spesifik user ini.
PENTING: Lo punya memori percakapan — kalau user nanya lanjutan, gunakan konteks sebelumnya.

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

ATURAN JAWABAN:
- Jawab langsung, to-the-point, max 5-7 kalimat
- Kalau pertanyaan lanjutan, sambung dari konteks percakapan sebelumnya
- Kalau pertanyaan di luar topik diet/nutrisi/olahraga/kesehatan, tolak dengan sopan
- Gunakan angka spesifik dari data user kalau relevan

Balas HANYA teks jawabannya saja, tanpa label atau prefix apapun.
    `.trim();

    // Build contents array untuk Gemini — support multi-turn conversation
    // Format: [system, ...history, pertanyaan terbaru]
    const contents = [
        // Pesan pertama: system prompt sebagai konteks (role user, tapi isinya instruksi)
        { role: 'user',  parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Siap! Gua Coach NutriBot, tanya aja soal diet & nutrisi lo.' }] },

        // Inject history percakapan sebelumnya
        ...history.map(msg => ({
            role:  msg.role === 'user' ? 'user' : 'model', // Gemini pakai 'model' bukan 'assistant'
            parts: [{ text: msg.content }]
        })),

        // Pertanyaan terbaru
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


module.exports = {
    analyzeFoodImage,
    estimateNutritionFromText,
    generateCoachAnswer,
    downloadImage
};