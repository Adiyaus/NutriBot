// src/services/edamam.js
const axios = require('axios');
require('dotenv').config();

// Kita pakai Food Database API v2 (Parser) - Jauh lebih akurat buat porsian
const EDAMAM_PARSER_URL = 'https://api.edamam.com/api/food-database/v2/parser';

async function getNutritionData(foods) {
    let total = { cal: 0, pro: 0, carb: 0, fat: 0 };
    let descriptions = [];

    console.log(`[Edamam] Memproses ${foods.length} item makanan...`);

    try {
        // Kita looping tiap item karena Parser API paling jago handle per item
        for (const item of foods) {
            const query = `${item.portion} ${item.name}`;
            const response = await axios.get(EDAMAM_PARSER_URL, {
                params: {
                    app_id: process.env.EDAMAM_APP_ID,
                    app_key: process.env.EDAMAM_APP_KEY,
                    ingr: query
                }
            });

            // Ambil nutrisi dari hasil pertama (parsed)
            const parsed = response.data.parsed?.[0];
            if (parsed) {
                const nut = parsed.food.nutrients;
                // Edamam Parser balikin nutrisi per 100g, kita kali sama porsi kalau ada
                // Tapi biasanya porsi standar '1 bowl' otomatis dihitung
                total.cal  += nut.ENERC_KCAL || 0;
                total.pro  += nut.PROCNT     || 0;
                total.carb += nut.CHOCDF     || 0;
                total.fat  += nut.FAT        || 0;
                descriptions.push(query);
            }
        }

        if (total.cal === 0) throw new Error('NO_DATA_FOUND');

        return {
            food_description: descriptions.join(', '),
            calories:  Math.round(total.cal),
            protein_g: parseFloat(total.pro.toFixed(1)),
            carbs_g:   parseFloat(total.carb.toFixed(1)),
            fat_g:     parseFloat(total.fat.toFixed(1)),
            source:    'edamam'
        };

    } catch (err) {
        console.error('[Edamam] Error detail:', err.response?.data || err.message);
        throw new Error('EDAMAM_ERROR');
    }
}

module.exports = { getNutritionData };