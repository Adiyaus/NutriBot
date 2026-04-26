// src/services/edamam.js
const axios = require('axios');
require('dotenv').config();

// Gunakan endpoint 'nutrition-details' untuk POST (analisis porsi lengkap)
const EDAMAM_POST_URL = 'https://api.edamam.com/api/nutrition-details';

/**
 * Fungsi: getNutritionData
 * Penjelasan: Mengambil array makanan dari Gemini, lalu mengirimnya sebagai 
 * body request (POST) ke Edamam. Ini jauh lebih akurat buat analisis satu piring.
 */
async function getNutritionData(foods) {
    // Bikin array string: ["2 bowls rice", "1 fried egg", ...]
    const ingredients = foods.map(f => `${f.portion} ${f.name}`);
    
    console.log(`[Edamam] Analyzing Meal:`, ingredients);

    try {
        const response = await axios.post(
            `${EDAMAM_POST_URL}?app_id=${process.env.EDAMAM_APP_ID}&app_key=${process.env.EDAMAM_APP_KEY}`,
            { ingr: ingredients }, // Body JSON berisi list makanan
            { 
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000 // Kasih waktu lebih lama (15 detik) karena hitungannya kompleks
            }
        );

        const data = response.data;

        // Pastiin ada data yang balik, kalau gak ada kasih default 0 biar gak NaN
        return {
            food_description: ingredients.join(', '),
            calories:  Math.round(data.calories || 0), // Safety: || 0 cegah NaN
            protein_g: parseFloat((data.totalNutrients?.PROCNT?.quantity || 0).toFixed(1)),
            carbs_g:   parseFloat((data.totalNutrients?.CHOCDF?.quantity || 0).toFixed(1)),
            fat_g:     parseFloat((data.totalNutrients?.FAT?.quantity || 0).toFixed(1)),
            source:    'edamam'
        };

    } catch (err) {
        // Jika Edamam gagal (422), biasanya karena ada item yang namanya aneh/gak dikenal
        console.error('[Edamam] Error:', err.response?.data || err.message);
        throw new Error('EDAMAM_ERROR');
    }
}

/**
 * Fungsi: buildFallbackNutrition
 * Penjelasan: Cadangan kalau API Edamam lagi down atau limit.
 */
function buildFallbackNutrition(description) {
    return {
        food_description: description || 'Makanan tidak teridentifikasi',
        calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
        source: 'fallback'
    };
}

module.exports = { getNutritionData, buildFallbackNutrition };