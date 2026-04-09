// ============================================================
// src/services/gemini.js
// Full Gemini — identifikasi makanan + estimasi nutrisi sekaligus
// Model: gemini-2.5-flash (free, akurat, 2026)
// ============================================================

const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * Download foto dari Telegram server sebagai Buffer
 */
async function downloadImage(fileUrl) {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}

/**
 * Analisis foto makanan — identifikasi nama + estimasi nutrisi sekaligus
 * @param {Buffer} imageBuffer
 * @param {string} mimeType
 * @returns {object} { is_food, food_description, calories, protein_g, carbs_g, fat_g, confidence }
 */
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
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType, data: base64Image } }
                    ]
                }
            ]
        });

        const rawText = response.text;

        // Bersihkan backtick kalau Gemini nambahin markdown
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

        // Kalau bukan makanan
        if (!parsed.is_food) {
            return {
                is_food: false,
                food_description: '', calories: 0,
                protein_g: 0, carbs_g: 0, fat_g: 0,
                confidence: 'low'
            };
        }

        // Validasi & sanitasi nilai numerik
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

    } catch (err) {
        if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota')) {
            console.log('[Gemini] Rate limit hit, retrying in 5s...');
            await new Promise(res => setTimeout(res, 5000));
            throw new Error('RATE_LIMIT');
        }
        if (err.message?.includes('SAFETY'))  throw new Error('SAFETY_BLOCK');
        if (err.message === 'PARSE_ERROR')    throw new Error('PARSE_ERROR');
        console.error('[Gemini] Unexpected error:', err.message);
        throw new Error('GEMINI_ERROR');
    }
}

module.exports = { analyzeFoodImage, downloadImage };