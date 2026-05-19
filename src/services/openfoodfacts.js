// ============================================================
// src/services/openfoodfacts.js
// OpenFoodFacts API — barcode lookup + name search
// Docs: https://world.openfoodfacts.org/data
// Free, no API key needed!
//
// CHANGELOG:
//   + searchByName()    → lookup by food name (buat fallback chain)
//   ~ lookup timeout diperpendek (6s → 5s) biar Vercel gak nunggu lama
// ============================================================

const axios = require('axios');

const OFF_BASE_URL      = 'https://world.openfoodfacts.org/api/v2';
const OFF_SEARCH_URL    = 'https://world.openfoodfacts.org/cgi/search.pl';
const REQUEST_TIMEOUT   = 5000; // lebih pendek → fail fast ke layer berikutnya

const USER_AGENT = 'NutriBot-Telegram/1.0 (https://github.com/nutribot)';

// ─── BARCODE LOOKUP (existing — tidak berubah) ────────────────

/**
 * Cari produk berdasarkan barcode (EAN-13, EAN-8, UPC, dll)
 *
 * @param {string} barcode
 * @returns {object|null}
 */
async function lookupBarcode(barcode) {
    if (!barcode || typeof barcode !== 'string') return null;

    const cleanBarcode = barcode.replace(/\D/g, '').trim();
    if (cleanBarcode.length < 8) {
        console.warn(`[OFF] Barcode terlalu pendek: "${cleanBarcode}"`);
        return null;
    }

    console.log(`[OFF] Lookup barcode: ${cleanBarcode}`);

    try {
        const response = await axios.get(`${OFF_BASE_URL}/product/${cleanBarcode}`, {
            params: {
                fields: [
                    'product_name', 'product_name_id', 'brands',
                    'quantity', 'serving_size', 'nutriments',
                    'image_front_url', 'completeness', 'status'
                ].join(',')
            },
            timeout: REQUEST_TIMEOUT,
            headers: { 'User-Agent': USER_AGENT }
        });

        const data = response.data;
        if (data.status !== 1 || !data.product) {
            console.log(`[OFF] Produk tidak ditemukan: ${cleanBarcode}`);
            return null;
        }

        return parseProductData(data.product, cleanBarcode);

    } catch (err) {
        if (err.code === 'ECONNABORTED') {
            console.warn('[OFF] Barcode lookup timeout');
        } else {
            console.error('[OFF] Barcode lookup error:', err.response?.status || err.message);
        }
        return null;
    }
}

// ─── NAME SEARCH (NEW) ────────────────────────────────────────

/**
 * Cari produk berdasarkan nama — untuk fallback chain di nutritionResolver
 * Return produk pertama yang punya data nutrisi lengkap
 *
 * Strategi:
 *   1. Search dengan nama English (lebih akurat di OFF)
 *   2. Filter hasil yang ada data kalori
 *   3. Prioritaskan produk dengan completeness tinggi
 *   4. Ambil yang pertama (paling relevan menurut OFF)
 *
 * @param {string} foodName - nama makanan dalam bahasa Inggris (dari normalizeFood)
 * @returns {object|null} product data dengan per_100g nutrition, atau null
 */
async function searchByName(foodName) {
    if (!foodName || typeof foodName !== 'string') return null;

    const cleanName = foodName.trim();
    console.log(`[OFF] Search by name: "${cleanName}"`);

    try {
        const response = await axios.get(OFF_SEARCH_URL, {
            params: {
                search_terms:   cleanName,
                search_simple:  1,
                action:         'process',
                json:           1,
                page_size:      5,            // ambil 5, pilih yang terbaik
                page:           1,
                fields: [
                    'product_name', 'brands',
                    'serving_size', 'nutriments',
                    'completeness', 'countries_tags'
                ].join(','),
            },
            timeout: REQUEST_TIMEOUT,
            headers: { 'User-Agent': USER_AGENT }
        });

        const products = response.data?.products;
        if (!Array.isArray(products) || products.length === 0) {
            console.log(`[OFF] Tidak ada hasil untuk: "${cleanName}"`);
            return null;
        }

        // Filter: harus ada kalori yang valid
        const withCalories = products.filter(p => {
            const cal = p.nutriments?.['energy-kcal_100g'] ?? p.nutriments?.['energy-kcal'];
            return cal && cal > 0;
        });

        if (withCalories.length === 0) {
            console.log(`[OFF] Hasil ada tapi tidak ada data kalori: "${cleanName}"`);
            return null;
        }

        // Sort: prioritaskan completeness tinggi
        withCalories.sort((a, b) => (b.completeness || 0) - (a.completeness || 0));

        const best = withCalories[0];
        const parsed = parseProductData(best, cleanName);
        if (!parsed) return null;

        console.log(`[OFF] ✅ Name search hit: "${parsed.product_name}" (completeness: ${Math.round((best.completeness || 0) * 100)}%)`);
        return parsed;

    } catch (err) {
        if (err.code === 'ECONNABORTED') {
            console.warn('[OFF] Name search timeout');
        } else {
            console.error('[OFF] Name search error:', err.response?.status || err.message);
        }
        return null; // selalu return null, jangan throw — biar resolver lanjut ke layer berikutnya
    }
}

// ─── PARSE PRODUCT DATA ───────────────────────────────────────

function parseProductData(product, identifier) {
    const n = product.nutriments || {};

    const caloriesPer100g = n['energy-kcal_100g'] ?? n['energy-kcal'] ?? null;
    if (caloriesPer100g === null) {
        console.log(`[OFF] Data kalori tidak ada untuk: ${identifier}`);
        return null;
    }

    const productName = (
        product.product_name_id ||
        product.product_name    ||
        product.brands          ||
        'Unknown Product'
    ).trim();

    const servingSize = parseServingSize(product.serving_size);

    const per_100g = {
        calories:  Math.round(caloriesPer100g),
        protein_g: parseFloat((Number(n.proteins_100g)      || 0).toFixed(1)),
        carbs_g:   parseFloat((Number(n.carbohydrates_100g) || 0).toFixed(1)),
        fat_g:     parseFloat((Number(n.fat_100g)           || 0).toFixed(1)),
    };

    let per_serving = null;
    if (servingSize?.grams > 0) {
        const ratio = servingSize.grams / 100;
        per_serving = {
            calories:  Math.round(per_100g.calories  * ratio),
            protein_g: parseFloat((per_100g.protein_g * ratio).toFixed(1)),
            carbs_g:   parseFloat((per_100g.carbs_g   * ratio).toFixed(1)),
            fat_g:     parseFloat((per_100g.fat_g     * ratio).toFixed(1)),
        };
    }

    return {
        found:          true,
        product_name:   productName,
        brand:          product.brands || null,
        quantity:       product.quantity || null,
        serving_size:   product.serving_size || null,
        serving_grams:  servingSize?.grams || null,
        per_100g,
        per_serving,
        image_url:      product.image_front_url || null,
        data_source:    'openfoodfacts',
        completeness:   product.completeness || 0,
    };
}

// ─── PARSE SERVING SIZE ───────────────────────────────────────

function parseServingSize(servingSizeStr) {
    if (!servingSizeStr) return null;
    const str = servingSizeStr.toLowerCase().trim();

    const parenMatch  = str.match(/\((\d+(?:\.\d+)?)\s*g(?:ram)?s?\)/);
    if (parenMatch) return { grams: parseFloat(parenMatch[1]) };

    const directMatch = str.match(/^(\d+(?:\.\d+)?)\s*g(?:ram)?s?/);
    if (directMatch) return { grams: parseFloat(directMatch[1]) };

    const mlMatch     = str.match(/^(\d+(?:\.\d+)?)\s*ml/);
    if (mlMatch) return { grams: parseFloat(mlMatch[1]) };

    return null;
}

// ─── FORMAT → NUTRIBOT FORMAT ─────────────────────────────────

/**
 * Convert OFF result ke format standar NutriBot
 * (untuk backward-compat dengan barcode flow yang sudah ada)
 *
 * @param {object} offResult - hasil dari lookupBarcode() atau searchByName()
 * @returns {object|null}
 */
function toNutriFormat(offResult) {
    if (!offResult?.found) return null;

    const useServing = offResult.per_serving !== null;
    const nutrition  = useServing ? offResult.per_serving : offResult.per_100g;
    const basisNote  = useServing
        ? `per sajian (${offResult.serving_size})`
        : 'per 100g (ukuran sajian tidak tersedia)';

    const brandPart = offResult.brand ? ` (${offResult.brand})` : '';

    return {
        is_food:          true,
        food_description: `${offResult.product_name}${brandPart}`,
        food_items:       [],
        calories:         nutrition.calories,
        protein_g:        nutrition.protein_g,
        carbs_g:          nutrition.carbs_g,
        fat_g:            nutrition.fat_g,
        confidence:       offResult.completeness > 0.6 ? 'high' : 'medium',
        notes:            `Data dari OpenFoodFacts, ${basisNote}`,
        gemini_raw:       null,
        data_source:      'openfoodfacts',
        off_data:         offResult,
    };
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    lookupBarcode,
    searchByName,    // NEW
    toNutriFormat,
    parseServingSize,
};