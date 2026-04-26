// src/services/edamam.js
const axios = require('axios');
require('dotenv').config();

const EDAMAM_URL = 'https://api.edamam.com/api/nutrition-data';

/**
 * Fungsi: getNutritionData
 * Penjelasan: Mengambil list makanan (nama & porsi) hasil deteksi Gemini, 
 * lalu menembak API Edamam untuk mendapatkan detail nutrisi makro.
 */
async function getNutritionData(foods) {
    // Gabungin list dari Gemini jadi satu string natural language
    // Misal: "1 bowl of chicken soup, 200g rice"
    const query = foods
        .map(f => `${f.portion} ${f.name}`)
        .join(', ');

    console.log(`[Edamam] Querying: "${query}"`);

    try {
        const response = await axios.get(EDAMAM_URL, {
            params: {
                app_id: process.env.EDAMAM_APP_ID,
                app_key: process.env.EDAMAM_APP_KEY,
                ingr: query // Edamam butuh param 'ingr' (ingredients)
            },
            timeout: 10000
        });

        const data = response.data;

        // Validasi: Edamam biasanya return calories 0 kalau makanan gak jelas
        if (!data || (data.calories === 0 && data.totalWeight === 0)) {
            throw new Error('NO_RESULTS');
        }

        return {
            food_description: query,
            calories:  Math.round(data.calories),
            // Ambil data protein, karbo, lemak dari object totalNutrients
            protein_g: parseFloat((data.totalNutrients?.PROCNT?.quantity || 0).toFixed(1)),
            carbs_g:   parseFloat((data.totalNutrients?.CHOCDF?.quantity || 0).toFixed(1)),
            fat_g:     parseFloat((data.totalNutrients?.FAT?.quantity || 0).toFixed(1)),
            source:    'edamam'
        };

    } catch (err) {
        if (err.message === 'NO_RESULTS') throw new Error('NO_RESULTS');
        console.error('[Edamam] Error:', err.message);
        throw new Error('EDAMAM_ERROR');
    }
}

/**
 * Fungsi: buildFallbackNutrition
 * Penjelasan: Safety net kalau API limit atau error, biar bot gak crash total.
 */
function buildFallbackNutrition(description) {
    return {
        food_description: description || 'Makanan tidak teridentifikasi',
        calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
        source: 'fallback'
    };
}

module.exports = { getNutritionData, buildFallbackNutrition };