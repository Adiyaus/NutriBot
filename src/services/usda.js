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
 *
 * Strategi baru (USDA as primary source of truth):
 * - USDA ≥ 70% coverage → pakai USDA murni, Gemini hanya untuk item yang tidak ketemu
 * - USDA 30-70% coverage → USDA untuk item yang ketemu + Gemini untuk sisanya (additive, bukan average)
 * - USDA < 30% coverage  → fallback ke Gemini, tapi tetap pakai USDA untuk item yang ketemu
 *
 * KENAPA bukan weighted average lagi:
 * - Average 60/40 berarti kalori USDA yang akurat masih "dikotori" estimasi Gemini
 * - Kalau USDA ketemu "steamed rice 200g = 260 kkal", itu angka fixed — tidak perlu di-average
 * - Weighted average justru menambah inkonsistensi karena Gemini bisa berbeda tiap request
 *
 * @param {object} geminiResult - hasil dari gemini.estimateNutritionFromText / analyzeFoodImage
 * @param {Array}  usdaItems    - hasil dari lookupMultipleFoods
 * @returns {object} merged result dengan data_source yang menjelaskan strategi yang dipakai
 */
function reconcileResults(geminiResult, usdaItems) {
    if (!usdaItems || usdaItems.length === 0) {
        return { ...geminiResult, data_source: 'gemini_only' };
    }

    const foundItems    = usdaItems.filter(i => i.usda_found);
    const missingItems  = usdaItems.filter(i => !i.usda_found);
    const coverageRatio = foundItems.length / usdaItems.length;

    // ── Kasus 1: USDA coverage bagus (≥ 70%) ────────────────
    // Pakai USDA sebagai primary — kalori dari database, bukan AI
    if (coverageRatio >= 0.7) {
        const usdaTotal = foundItems.reduce((acc, item) => ({
            calories:  acc.calories  + (item.calories  || 0),
            protein_g: acc.protein_g + (item.protein_g || 0),
            carbs_g:   acc.carbs_g   + (item.carbs_g   || 0),
            fat_g:     acc.fat_g     + (item.fat_g     || 0),
        }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

        // Kalau ada item yang tidak ketemu USDA, estimasi proporsinya dari Gemini
        // Misal: 3 item ketemu, 1 tidak → item yang tidak ketemu ≈ 25% dari total Gemini
        let missingEstimate = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
        if (missingItems.length > 0) {
            const missingRatio = missingItems.length / usdaItems.length;
            missingEstimate = {
                calories:  Math.round(geminiResult.calories  * missingRatio),
                protein_g: parseFloat((geminiResult.protein_g * missingRatio).toFixed(1)),
                carbs_g:   parseFloat((geminiResult.carbs_g   * missingRatio).toFixed(1)),
                fat_g:     parseFloat((geminiResult.fat_g      * missingRatio).toFixed(1)),
            };
        }

        return {
            ...geminiResult,
            calories:  Math.round(usdaTotal.calories  + missingEstimate.calories),
            protein_g: parseFloat((usdaTotal.protein_g + missingEstimate.protein_g).toFixed(1)),
            carbs_g:   parseFloat((usdaTotal.carbs_g   + missingEstimate.carbs_g).toFixed(1)),
            fat_g:     parseFloat((usdaTotal.fat_g      + missingEstimate.fat_g).toFixed(1)),
            data_source:      'usda_primary',
            usda_coverage:    `${foundItems.length}/${usdaItems.length} item`,
            usda_items_found: foundItems.map(i => i.usda_desc),
            confidence:       'high',
        };
    }

    // ── Kasus 2: USDA coverage partial (30-70%) ───────────────
    // Additive: item yang ketemu pakai USDA, item yang tidak pakai proporsi Gemini
    if (coverageRatio >= 0.3) {
        const usdaSubtotal = foundItems.reduce((acc, item) => ({
            calories:  acc.calories  + (item.calories  || 0),
            protein_g: acc.protein_g + (item.protein_g || 0),
            carbs_g:   acc.carbs_g   + (item.carbs_g   || 0),
            fat_g:     acc.fat_g     + (item.fat_g     || 0),
        }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

        const missingRatio = missingItems.length / usdaItems.length;
        const geminiForMissing = {
            calories:  Math.round(geminiResult.calories  * missingRatio),
            protein_g: parseFloat((geminiResult.protein_g * missingRatio).toFixed(1)),
            carbs_g:   parseFloat((geminiResult.carbs_g   * missingRatio).toFixed(1)),
            fat_g:     parseFloat((geminiResult.fat_g      * missingRatio).toFixed(1)),
        };

        return {
            ...geminiResult,
            calories:  Math.round(usdaSubtotal.calories  + geminiForMissing.calories),
            protein_g: parseFloat((usdaSubtotal.protein_g + geminiForMissing.protein_g).toFixed(1)),
            carbs_g:   parseFloat((usdaSubtotal.carbs_g   + geminiForMissing.carbs_g).toFixed(1)),
            fat_g:     parseFloat((usdaSubtotal.fat_g      + geminiForMissing.fat_g).toFixed(1)),
            data_source:      'usda_partial',
            usda_coverage:    `${foundItems.length}/${usdaItems.length} item`,
            usda_items_found: foundItems.map(i => i.usda_desc),
            confidence:       geminiResult.confidence === 'low' ? 'medium' : geminiResult.confidence,
        };
    }

    // ── Kasus 3: USDA coverage buruk (< 30%) ─────────────────
    // Fallback ke Gemini, tapi tetap pakai USDA untuk item yang ketemu (bukan average)
    if (foundItems.length > 0) {
        const usdaSubtotal = foundItems.reduce((acc, item) => ({
            calories:  acc.calories  + (item.calories  || 0),
            protein_g: acc.protein_g + (item.protein_g || 0),
            carbs_g:   acc.carbs_g   + (item.carbs_g   || 0),
            fat_g:     acc.fat_g     + (item.fat_g     || 0),
        }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

        const missingRatio = missingItems.length / usdaItems.length;
        const geminiForMissing = {
            calories:  Math.round(geminiResult.calories  * missingRatio),
            protein_g: parseFloat((geminiResult.protein_g * missingRatio).toFixed(1)),
            carbs_g:   parseFloat((geminiResult.carbs_g   * missingRatio).toFixed(1)),
            fat_g:     parseFloat((geminiResult.fat_g      * missingRatio).toFixed(1)),
        };

        return {
            ...geminiResult,
            calories:  Math.round(usdaSubtotal.calories  + geminiForMissing.calories),
            protein_g: parseFloat((usdaSubtotal.protein_g + geminiForMissing.protein_g).toFixed(1)),
            carbs_g:   parseFloat((usdaSubtotal.carbs_g   + geminiForMissing.carbs_g).toFixed(1)),
            fat_g:     parseFloat((usdaSubtotal.fat_g      + geminiForMissing.fat_g).toFixed(1)),
            data_source:   'gemini_primary',
            usda_coverage: `${foundItems.length}/${usdaItems.length} item`,
            confidence:    geminiResult.confidence,
        };
    }

    // Tidak ada USDA sama sekali → Gemini murni
    return { ...geminiResult, data_source: 'gemini_only', usda_coverage: '0/0 item' };
}

module.exports = {
    searchFood,
    getFoodDetail,
    lookupMultipleFoods,
    reconcileResults,
};