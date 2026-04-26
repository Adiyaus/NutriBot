// src/services/edamam.js
const axios = require('axios');
require('dotenv').config();

const EDAMAM_URL = 'https://api.edamam.com/api/nutrition-details';

/**
 * Fungsi: getNutritionData
 * Menghitung total nutrisi dari list makanan menggunakan metode POST.
 */
async function getNutritionData(ingredientsArray) {
    if (!ingredientsArray || ingredientsArray.length === 0) throw new Error('NO_ITEMS');

    try {
        const response = await axios.post(
            `${EDAMAM_URL}?app_id=${process.env.EDAMAM_APP_ID}&app_key=${process.env.EDAMAM_APP_KEY}`,
            { ingr: ingredientsArray },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );

        const data = response.data;
        return {
            calories:  Math.round(data.calories || 0),
            protein_g: parseFloat((data.totalNutrients?.PROCNT?.quantity || 0).toFixed(1)),
            carbs_g:   parseFloat((data.totalNutrients?.CHOCDF?.quantity || 0).toFixed(1)),
            fat_g:     parseFloat((data.totalNutrients?.FAT?.quantity || 0).toFixed(1))
        };
    } catch (err) {
        console.error('[Edamam] API Error:', err.response?.data || err.message);
        throw new Error('EDAMAM_ERROR');
    }
}

module.exports = { getNutritionData };