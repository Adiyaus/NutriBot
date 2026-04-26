// ============================================================
// src/services/usda.js
// USDA FoodData Central API — verifikasi & enrichment kalori
// Docs: https://fdc.nal.usda.gov/api-guide.html
// ============================================================

const axios = require('axios');
require('dotenv').config();

const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';

// ─── SEARCH FOOD ──────────────────────────────────────────────

/**
 * Cari makanan di USDA FoodData Central
 * Return top result yang paling relevan
 *
 * @param {string} query        - nama makanan (contoh: "nasi goreng", "fried rice")
 * @param {number} [maxResults] - jumlah hasil yang dikembalikan (default: 3)
 * @returns {Array} array of { fdcId, description, calories_per100g, protein_per100g, carbs_per100g, fat_per100g }
 */
async function searchFood(query, maxResults = 3) {
    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) {
        console.warn('[USDA] API key tidak ditemukan, skip USDA lookup');
        return [];
    }

    try {
        const response = await axios.get(`${USDA_BASE_URL}/foods/search`, {
            params: {
                query,
                api_key:     apiKey,
                pageSize:    maxResults,
                dataType:    'Foundation,SR Legacy,Branded',  // urutan prioritas data
            },
            timeout: 8000
        });

        const foods = response.data?.foods || [];
        if (foods.length === 0) return [];

        return foods.map(food => {
            // Cari nutrisi dari array foodNutrients
            const getNutrient = (nutrientId) => {
                const n = food.foodNutrients?.find(fn => fn.nutrientId === nutrientId);
                return n?.value ?? null;
            };

            return {
                fdcId:              food.fdcId,
                description:        food.description,
                dataType:           food.dataType,
                // Nilai per 100g — USDA pakai per 100g
                calories_per100g:   getNutrient(1008),  // Energy (kcal)
                protein_per100g:    getNutrient(1003),  // Protein
                carbs_per100g:      getNutrient(1005),  // Carbohydrate
                fat_per100g:        getNutrient(1004),  // Total lipid (fat)
            };
        }).filter(f => f.calories_per100g !== null); // filter kalau gak ada data kalori

    } catch (err) {
        console.error('[USDA] Search error:', err.response?.data || err.message);
        return []; // gagal → return empty, jangan throw (fallback ke Gemini aja)
    }
}

// ─── GET FOOD DETAIL ──────────────────────────────────────────

/**
 * Ambil detail nutrisi dari satu fdcId
 *
 * @param {number} fdcId
 * @returns {object|null} { fdcId, description, calories_per100g, protein_per100g, carbs_per100g, fat_per100g }
 */
async function getFoodDetail(fdcId) {
    const apiKey = process.env.USDA_API_KEY;
    if (!apiKey) return null;

    try {
        const response = await axios.get(`${USDA_BASE_URL}/food/${fdcId}`, {
            params: { api_key: apiKey },
            timeout: 8000
        });

        const food = response.data;
        const getNutrient = (nutrientNumber) => {
            const n = food.foodNutrients?.find(fn =>
                fn.nutrient?.number === nutrientNumber ||
                fn.nutrientNumber === nutrientNumber
            );
            return n?.amount ?? null;
        };

        return {
            fdcId:            food.fdcId,
            description:      food.description,
            calories_per100g: getNutrient('208'),  // Energy
            protein_per100g:  getNutrient('203'),  // Protein
            carbs_per100g:    getNutrient('205'),  // Carbohydrate
            fat_per100g:      getNutrient('204'),  // Total fat
        };

    } catch (err) {
        console.error('[USDA] Detail error:', err.message);
        return null;
    }
}

// ─── LOOKUP MULTIPLE FOODS ────────────────────────────────────

/**
 * Lookup nutrisi untuk list makanan dari Gemini
 * Return map: { foodItem → usda_result | null }
 *
 * @param {Array<{name: string, portion_g: number}>} items
 *   List makanan + estimasi berat porsi (dalam gram)
 * @returns {Array<{name, portion_g, usda_found, calories, protein_g, carbs_g, fat_g}>}
 */
async function lookupMultipleFoods(items) {
    if (!items || items.length === 0) return [];

    const results = await Promise.all(
        items.map(async (item) => {
            const searchResults = await searchFood(item.name, 1);

            if (searchResults.length === 0) {
                return { ...item, usda_found: false };
            }

            const best = searchResults[0];
            const portionG = item.portion_g || 100; // default 100g kalau gak ada estimasi

            // Kalkulasi dari per-100g ke actual portion
            const scale = portionG / 100;
            return {
                name:        item.name,
                portion_g:   portionG,
                usda_found:  true,
                usda_desc:   best.description,
                usda_fdcId:  best.fdcId,
                calories:    Math.round((best.calories_per100g || 0) * scale),
                protein_g:   parseFloat(((best.protein_per100g || 0) * scale).toFixed(1)),
                carbs_g:     parseFloat(((best.carbs_per100g   || 0) * scale).toFixed(1)),
                fat_g:       parseFloat(((best.fat_per100g     || 0) * scale).toFixed(1)),
            };
        })
    );

    return results;
}

// ─── RECONCILE GEMINI + USDA ──────────────────────────────────

/**
 * Gabungkan hasil Gemini dengan data USDA
 * Strategi:
 * - Kalau USDA berhasil: weighted average (60% USDA, 40% Gemini) → lebih reliable
 * - Kalau USDA gagal/partial: fallback ke Gemini murni
 *
 * @param {object} geminiResult     - hasil dari gemini.estimateNutritionFromText / analyzeFoodImage
 * @param {Array}  usdaItems        - hasil dari lookupMultipleFoods
 * @returns {object} merged result
 */
function reconcileResults(geminiResult, usdaItems) {
    if (!usdaItems || usdaItems.length === 0) {
        return { ...geminiResult, data_source: 'gemini_only' };
    }

    const foundItems  = usdaItems.filter(i => i.usda_found);
    const coverageRatio = foundItems.length / usdaItems.length;

    // Kalau kurang dari 50% item ditemukan USDA, trust Gemini lebih
    if (coverageRatio < 0.5) {
        return { ...geminiResult, data_source: 'gemini_primary', usda_partial: true };
    }

    // Hitung total dari USDA
    const usdaTotal = foundItems.reduce((acc, item) => ({
        calories:  acc.calories  + (item.calories  || 0),
        protein_g: acc.protein_g + (item.protein_g || 0),
        carbs_g:   acc.carbs_g   + (item.carbs_g   || 0),
        fat_g:     acc.fat_g     + (item.fat_g     || 0),
    }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

    // Weighted average: 60% USDA + 40% Gemini
    // → hasil lebih stabil, gak murni satu sumber
    const w_usda   = 0.6;
    const w_gemini = 0.4;

    const merged = {
        ...geminiResult,
        calories:  Math.round(usdaTotal.calories  * w_usda + geminiResult.calories  * w_gemini),
        protein_g: parseFloat((usdaTotal.protein_g * w_usda + geminiResult.protein_g * w_gemini).toFixed(1)),
        carbs_g:   parseFloat((usdaTotal.carbs_g   * w_usda + geminiResult.carbs_g   * w_gemini).toFixed(1)),
        fat_g:     parseFloat((usdaTotal.fat_g      * w_usda + geminiResult.fat_g     * w_gemini).toFixed(1)),

        // Metadata sumber data
        data_source:       'gemini_usda_merged',
        usda_coverage:     `${foundItems.length}/${usdaItems.length} item`,
        usda_items_found:  foundItems.map(i => i.usda_desc),

        // Naikkan confidence kalau USDA support Gemini
        confidence: geminiResult.confidence === 'low' ? 'medium' : 'high',
    };

    return merged;
}

module.exports = {
    searchFood,
    getFoodDetail,
    lookupMultipleFoods,
    reconcileResults,
};