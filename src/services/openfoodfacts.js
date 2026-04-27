// ============================================================
// src/services/openfoodfacts.js
// OpenFoodFacts API — lookup nutrisi dari barcode produk kemasan
// Docs: https://world.openfoodfacts.org/data
// Free, no API key needed!
// ============================================================

const axios = require('axios');

const OFF_BASE_URL = 'https://world.openfoodfacts.org/api/v2';

// Timeout lebih pendek — kalau lambat, langsung fallback ke Gemini
const REQUEST_TIMEOUT = 6000;

// ─── BARCODE LOOKUP ───────────────────────────────────────────

/**
 * Cari produk berdasarkan barcode (EAN-13, EAN-8, UPC, dll)
 * Return null kalau tidak ditemukan atau data nutrisi tidak lengkap
 *
 * @param {string} barcode - kode barcode (contoh: "8996001303603")
 * @returns {object|null} data nutrisi produk atau null kalau tidak ketemu
 */
async function lookupBarcode(barcode) {
    if (!barcode || typeof barcode !== 'string') return null;

    // Bersihkan barcode — kadang hasil Gemini ada spasi atau karakter aneh
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
                    'product_name',
                    'product_name_id',   // nama dalam Bahasa Indonesia kalau ada
                    'brands',
                    'quantity',
                    'serving_size',
                    'nutriments',
                    'image_front_url',
                    'completeness',
                    'status'
                ].join(',')
            },
            timeout: REQUEST_TIMEOUT,
            headers: {
                // Identify ourselves sebagai NutriBot — good practice untuk Open Data
                'User-Agent': 'NutriBot-Telegram/1.0 (contact via Telegram @NutriBot)'
            }
        });

        const data = response.data;

        // OFF return status: 1 = found, 0 = not found
        if (data.status !== 1 || !data.product) {
            console.log(`[OFF] Produk tidak ditemukan: ${cleanBarcode}`);
            return null;
        }

        return parseProductData(data.product, cleanBarcode);

    } catch (err) {
        if (err.code === 'ECONNABORTED') {
            console.warn('[OFF] Timeout, fallback ke Gemini');
        } else {
            console.error('[OFF] Lookup error:', err.response?.status || err.message);
        }
        return null; // selalu fallback ke Gemini, jangan throw
    }
}

// ─── PARSE PRODUCT DATA ───────────────────────────────────────

/**
 * Parse raw product data dari OFF → format standar NutriBot
 * Semua nilai nutrisi OFF adalah per 100g/100ml
 *
 * @param {object} product - raw product dari OFF API
 * @param {string} barcode - barcode untuk logging
 * @returns {object|null} data nutrisi terstandarisasi atau null kalau data gak lengkap
 */
function parseProductData(product, barcode) {
    const n = product.nutriments || {};

    // Kalori wajib ada — kalau gak ada, data gak berguna
    const caloriesPer100g = n['energy-kcal_100g'] ?? n['energy-kcal'] ?? null;
    if (caloriesPer100g === null || caloriesPer100g === undefined) {
        console.log(`[OFF] Data kalori tidak ada untuk barcode ${barcode}`);
        return null;
    }

    // Ambil nama produk — prioritas: nama Indonesia > nama umum > brands
    const productName = (
        product.product_name_id ||
        product.product_name    ||
        product.brands          ||
        'Produk tidak diketahui'
    ).trim();

    // Parse ukuran serving — OFF kadang pakai format "30g" atau "2 biscuits (30g)"
    const servingSize = parseServingSize(product.serving_size);

    // Nutrisi per 100g dari OFF
    const per100g = {
        calories:  Math.round(caloriesPer100g),
        protein_g: parseFloat((Number(n.proteins_100g)      || 0).toFixed(1)),
        carbs_g:   parseFloat((Number(n.carbohydrates_100g) || 0).toFixed(1)),
        fat_g:     parseFloat((Number(n.fat_100g)           || 0).toFixed(1)),
    };

    // Hitung per serving kalau ada data serving size
    let perServing = null;
    if (servingSize?.grams > 0) {
        const ratio = servingSize.grams / 100;
        perServing = {
            calories:  Math.round(per100g.calories  * ratio),
            protein_g: parseFloat((per100g.protein_g * ratio).toFixed(1)),
            carbs_g:   parseFloat((per100g.carbs_g   * ratio).toFixed(1)),
            fat_g:     parseFloat((per100g.fat_g     * ratio).toFixed(1)),
        };
    }

    console.log(`[OFF] ✅ Ketemu: ${productName} | ${per100g.calories} kcal/100g`);

    return {
        found:          true,
        barcode:        barcode,
        product_name:   productName,
        brand:          product.brands || null,
        quantity:       product.quantity || null,
        serving_size:   product.serving_size || null,
        serving_grams:  servingSize?.grams || null,
        per_100g:       per100g,
        per_serving:    perServing,
        image_url:      product.image_front_url || null,
        data_source:    'openfoodfacts',
        completeness:   product.completeness || 0,  // 0-1, seberapa lengkap data produk
    };
}

// ─── PARSE SERVING SIZE ───────────────────────────────────────

/**
 * Parse string serving size ke angka gram
 * OFF punya berbagai format: "30g", "30 g", "1 biscuit (30g)", "250ml", dll
 *
 * @param {string|null} servingSizeStr
 * @returns {{ grams: number }|null}
 */
function parseServingSize(servingSizeStr) {
    if (!servingSizeStr) return null;

    const str = servingSizeStr.toLowerCase().trim();

    // Pattern: angka di dalam kurung + g/gram, contoh: "2 biscuits (30g)"
    const parenMatch = str.match(/\((\d+(?:\.\d+)?)\s*g(?:ram)?s?\)/);
    if (parenMatch) return { grams: parseFloat(parenMatch[1]) };

    // Pattern: angka langsung diikuti g/gram, contoh: "30g" atau "30 gram"
    const directMatch = str.match(/^(\d+(?:\.\d+)?)\s*g(?:ram)?s?/);
    if (directMatch) return { grams: parseFloat(directMatch[1]) };

    // Pattern: ml → asumsi 1ml = 1g (pendekatan untuk minuman)
    const mlMatch = str.match(/^(\d+(?:\.\d+)?)\s*ml/);
    if (mlMatch) return { grams: parseFloat(mlMatch[1]) };

    return null; // format tidak dikenali
}

// ─── FORMAT RESULT → NUTRIBOT FORMAT ─────────────────────────

/**
 * Convert OFF result ke format NutriBot yang sama dengan output Gemini
 * Biar bisa langsung di-drop-in ke flow yang sudah ada
 *
 * Kalau ada serving size → pakai per serving
 * Kalau tidak ada → pakai per 100g (dengan note ke user)
 *
 * @param {object} offResult - hasil dari lookupBarcode()
 * @returns {object} format NutriBot (is_food, food_description, calories, dst)
 */
function toNutriFormat(offResult) {
    if (!offResult?.found) return null;

    // Pilih basis perhitungan: per serving > per 100g
    const useServing = offResult.per_serving !== null;
    const nutrition  = useServing ? offResult.per_serving : offResult.per_100g;
    const basisNote  = useServing
        ? `per sajian (${offResult.serving_size})`
        : 'per 100g (ukuran sajian tidak tersedia)';

    const brandPart = offResult.brand ? ` (${offResult.brand})` : '';

    return {
        is_food:          true,
        food_description: `${offResult.product_name}${brandPart}`,
        food_items:       [],       // OFF sudah punya data lengkap, skip USDA lookup
        calories:         nutrition.calories,
        protein_g:        nutrition.protein_g,
        carbs_g:          nutrition.carbs_g,
        fat_g:            nutrition.fat_g,
        confidence:       'high',   // data dari kemasan = akurat
        notes:            `Data dari OpenFoodFacts, ${basisNote}`,
        gemini_raw:       null,
        data_source:      'openfoodfacts',
        off_data:         offResult, // simpan raw OFF data kalau dibutuhkan
    };
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    lookupBarcode,
    toNutriFormat,
    parseServingSize,   // export buat testing
};