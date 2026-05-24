// ============================================================
// src/engine/cookingAdjustment.js
// Layer 2: Cooking Method Detection + Calorie Adjustment
//
// MASALAH YANG DIPECAHKAN:
//   Database (TKPI, USDA) menyimpan nilai nutrisi dalam kondisi "ideal":
//   - Ayam goreng TKPI: 297 kcal/100g → digoreng dengan minyak minimal
//   - Ayam goreng warung Surabaya: 360-420 kcal/100g → minyak banyak, sering double fry
//   - Gap ini = 20-40% undercounting
//
// PENDEKATAN:
//   1. Deteksi metode masak dari nama makanan (keyword matching)
//   2. Lookup multiplier dari realisticMultipliers.js
//   3. Terapkan ke calories_per100g + fat_per100g
//   4. Return adjusted per100g + metadata (untuk debugging)
//
// PENTING:
//   - Adjustment TIDAK diterapkan ke nilai yang sudah dari cache
//     (asumsi: cache sudah menyimpan nilai yang pernah di-adjust)
//   - Adjustment TIDAK di-double untuk gemini_estimate
//     (geminiCalorieBias.js sudah handle itu)
//   - Jika tidak ada method yang terdeteksi → plain (1.0x)
// ============================================================

const M = require('../config/realisticMultipliers');

// ─── KEYWORD DETECTION MAPS ───────────────────────────────────
// Format: { method_key: [keyword, keyword, ...] }
// Dicheck berurutan — LEBIH SPESIFIK DULU

const COOKING_KEYWORDS = [

    // Geprek / Penyet: fried + smashed + sauce → highest oil
    {
        method: 'geprek_penyet',
        keywords: ['geprek', 'penyet', 'smashed fried'],
    },

    // Deep fried with batter (coating tebal)
    {
        method: 'deep_fried_battered',
        keywords: [
            'batter', 'mendoan', 'bakwan', 'pisang goreng', 'fried banana',
            'cireng', 'cilok goreng', 'ote-ote', 'temura', 'tempura',
            'risol', 'lumpia goreng', 'martabak',
            'onion ring', 'corn dog', 'fritter',
        ],
    },

    // Deep fried with breading (panir/coating)
    {
        method: 'deep_fried_breaded',
        keywords: [
            'crispy', 'krispy', 'breaded', 'panir', 'katsu', 'schnitzel',
            'nugget', 'chicken strip', 'fish and chip',
            'batagor', // goreng dengan tepung
        ],
    },

    // Stir fry heavy oil — MUST be checked BEFORE generic deep_fried_naked
    // "nasi goreng" has 'goreng' in the name but is NOT deep-fried
    {
        method: 'stir_fry_heavy',
        keywords: [
            'nasi goreng', 'fried rice',
            'mie goreng', 'fried noodles', 'fried noodle',
            'kwetiau goreng', 'bihun goreng', 'noodle fried',
            'cap cay', 'capcay', 'chinese stir fry', 'chinese stir-fry',
            'nasi campur', 'nasi padang',  // selalu disajikan dengan lauk berminyak
        ],
    },

    // Deep fried (plain / naked)
    {
        method: 'deep_fried_naked',
        keywords: [
            'goreng', 'fried', 'deep fry', 'deep-fry', 'deep fried',
            'gorengan', 'digoreng',
            'tahu goreng', 'tempe goreng', 'ikan goreng', 'ayam goreng',
            'udang goreng', 'cumi goreng', 'kentang goreng', 'french fries',
            'keripik', 'chips', 'donat', 'donut', 'churros',
        ],
    },

    // Coconut milk / santan-based
    {
        method: 'coconut_milk',
        keywords: [
            'santan', 'coconut milk', 'coconut cream',
            'opor', 'gulai', 'kari', 'curry', 'soto betawi',
            'nasi uduk', 'nasi gurih', 'rendang',  // rendang juga dulu pakai santan banyak
            'sayur lodeh', 'lodeh', 'kolak', 'es cendol',
        ],
    },

    // Heavy sauce (semur, balado, kari kering)
    {
        method: 'heavy_sauce',
        keywords: [
            'semur', 'balado', 'rica rica', 'kare', 'saus',
            'sambalado', 'bumbu merah', 'asam pedas',
            'telur balado', 'kentang balado',
        ],
    },

    // Grilled with marinade (ayam bakar, sate)
    {
        method: 'grilled_marinade',
        keywords: [
            'bakar', 'grilled', 'panggang', 'sate', 'satay',
            'bbq', 'barbeque',
        ],
    },

    // Stir fry light (tumis sayur)
    {
        method: 'stir_fry_light',
        keywords: [
            'tumis', 'stir fry', 'stir-fry', 'sauté', 'saute',
            'oseng', 'cah',
        ],
    },

    // Pan fried (telur ceplok, omelet, pancake)
    {
        method: 'pan_fried',
        keywords: [
            'telur goreng', 'fried egg', 'ceplok', 'mata sapi',
            'telur dadar', 'omelet', 'omelette', 'dadar',
            'pancake', 'crepe',
        ],
    },

    // Plain: boiled, steamed, raw
    {
        method: 'plain',
        keywords: [
            'rebus', 'boiled', 'kukus', 'steamed', 'mentah', 'raw',
            'sayur rebus', 'ayam rebus', 'telur rebus',
        ],
    },
];

// Foods to EXCLUDE from adjustment (nilai database sudah akurat / adjustment tidak relevan)
const SKIP_ADJUSTMENT_FOODS = [
    'buah', 'fruit', 'apple', 'banana', 'orange', 'mango', 'watermelon',
    'susu', 'milk', 'yogurt', 'keju', 'cheese',
    'air', 'water', 'teh', 'kopi black', 'juice',
    'indomie goreng',  // nilai kemasan sudah termasuk bumbu + minyak
    'indomie rebus',
];

// ─── CORE DETECTION ───────────────────────────────────────────

/**
 * Deteksi cooking method dari nama makanan
 *
 * @param {string} foodName - nama makanan (Indonesia / English)
 * @returns {{ method: string, multipliers: object, confidence: string }}
 */
function detectCookingMethod(foodName) {
    if (!foodName) return _makePlainResult();

    const name = foodName.toLowerCase().trim();

    // Skip adjustment untuk buah/minuman/packaged food
    if (SKIP_ADJUSTMENT_FOODS.some(skip => name.includes(skip))) {
        return _makePlainResult('skip_adjustment');
    }

    // Check each method (urut dari paling spesifik ke umum)
    for (const { method, keywords } of COOKING_KEYWORDS) {
        const matched = keywords.find(kw => name.includes(kw.toLowerCase()));
        if (matched) {
            const multipliers = M.cooking[method];
            if (!multipliers) continue;

            return {
                method,
                matched_keyword: matched,
                multipliers,
                confidence: 'high',
            };
        }
    }

    // Tidak ada match → default pan_fried untuk makanan "dimasak" yang tidak jelas
    // (lebih aman daripada plain → lebih realistic)
    return {
        method: 'pan_fried',
        matched_keyword: null,
        multipliers: M.cooking.pan_fried,
        confidence: 'low',  // low karena hanya asumsi
    };
}

/**
 * Terapkan cooking adjustment ke per100g object
 *
 * @param {object} per100g - { calories_per100g, fat_per100g, ... }
 * @param {string} foodName - nama makanan
 * @param {string} dataSource - sumber data: 'usda', 'indonesian_dataset', 'gemini_estimate', dll
 * @param {string} [variant='mid'] - 'min', 'mid', atau 'max'
 * @returns {object} adjusted per100g + cooking_adjustment metadata
 */
function applyCookingAdjustment(per100g, foodName, dataSource, variant = 'mid') {
    // Gemini estimate sudah ada biasnya sendiri via geminicaloriebias.js
    // Kita hanya apply cooking adjustment ke sumber lain
    // NOTE: untuk gemini_estimate kita tetap apply, tapi dengan multiplier lebih kecil
    const isGeminiEstimate = dataSource === 'gemini_estimate';

    const { method, matched_keyword, multipliers, confidence } = detectCookingMethod(foodName);

    // Kalau skip (buah/minuman/packaged)
    if (method === 'plain' && matched_keyword === null && confidence !== 'low') {
        return {
            ...per100g,
            cooking_adjustment: { method: 'skip', applied: false },
        };
    }

    // Pilih multiplier berdasarkan variant
    const calMultiplier = _pickVariant(multipliers, variant);
    const fatMultiplier = _pickFatVariant(multipliers, variant);

    // Untuk indonesian_dataset: nilai SUDAH realistis, kurangi multiplier drastis
    // (hanya 15% dari cooking multiplier — hanya untuk variance kecil)
    const isDataset = dataSource === 'indonesian_dataset';

    // Untuk gemini_estimate: kurangi multiplier (bias sudah ada sebelumnya)
    const effectiveCalMult = isGeminiEstimate
        ? 1 + (calMultiplier - 1) * 0.40   // hanya 40% dari multiplier
        : isDataset
            ? 1 + (calMultiplier - 1) * 0.18  // hanya 18% untuk dataset (sudah realistis)
            : calMultiplier;
    const effectiveFatMult = isGeminiEstimate
        ? 1 + (fatMultiplier - 1) * 0.40
        : isDataset
            ? 1 + (fatMultiplier - 1) * 0.18
            : fatMultiplier;

    // Apply dataset base correction dulu (TKPI/USDA → realistic)
    const baseCorrection = _getDatasetCorrection(dataSource, method);
    const correctedCal = (per100g.calories_per100g || 0) * baseCorrection;
    const correctedFat = (per100g.fat_per100g || 0) * baseCorrection;

    // Apply cooking multiplier
    const adjustedCal = Math.round(correctedCal * effectiveCalMult);
    const adjustedFat = parseFloat((correctedFat * effectiveFatMult).toFixed(1));

    // Apply Indonesian food floors (minimum kalori)
    const { finalCal, floorApplied } = _applyFloor(adjustedCal, foodName);
    const floorScale = floorApplied ? finalCal / adjustedCal : 1;

    // Carbs & protein: adjustment lebih kecil (koreksi minyak tidak langsung ubah carbs/protein)
    const macroMult = 1 + (effectiveCalMult - 1) * 0.3;
    const adjustedCarbs   = parseFloat(((per100g.carbs_per100g   || 0) * baseCorrection * macroMult).toFixed(1));
    const adjustedProtein = parseFloat(((per100g.protein_per100g || 0) * baseCorrection).toFixed(1)); // protein tidak berubah

    return {
        ...per100g,
        calories_per100g: finalCal,
        fat_per100g:      parseFloat((adjustedFat * floorScale).toFixed(1)),
        carbs_per100g:    adjustedCarbs,
        protein_per100g:  adjustedProtein,

        cooking_adjustment: {
            applied:              true,
            method,
            matched_keyword,
            method_confidence:    confidence,
            variant,
            cal_multiplier:       effectiveCalMult,
            fat_multiplier:       effectiveFatMult,
            dataset_correction:   baseCorrection,
            original_cal:         per100g.calories_per100g,
            adjusted_cal:         adjustedCal,
            final_cal:            finalCal,
            floor_applied:        floorApplied,
            gemini_reduced:       isGeminiEstimate,
        },
    };
}

/**
 * Apply cooking adjustment untuk semua 3 variants sekaligus
 * Returns { conservative, mid, upper } per100g objects
 *
 * @param {object} per100g
 * @param {string} foodName
 * @param {string} dataSource
 * @returns {{ conservative: object, mid: object, upper: object, method: string }}
 */
function applyCookingAdjustmentRange(per100g, foodName, dataSource) {
    const conservative = applyCookingAdjustment(per100g, foodName, dataSource, 'min');
    const mid          = applyCookingAdjustment(per100g, foodName, dataSource, 'mid');
    const upper        = applyCookingAdjustment(per100g, foodName, dataSource, 'max');

    return {
        conservative,
        mid,
        upper,
        method: mid.cooking_adjustment.method,
        matched_keyword: mid.cooking_adjustment.matched_keyword,
    };
}

// ─── HELPERS ──────────────────────────────────────────────────

function _makePlainResult(reason = 'plain') {
    return {
        method: 'plain',
        matched_keyword: reason,
        multipliers: M.cooking.plain,
        confidence: 'high',
    };
}

function _pickVariant(multipliers, variant) {
    if (variant === 'min') return multipliers.min;
    if (variant === 'max') return multipliers.max;
    return multipliers.mid;
}

function _pickFatVariant(multipliers, variant) {
    const fatMult = multipliers.fat_multiplier || 1.0;
    // fat_multiplier adalah nilai untuk 'mid'
    // min: lebih kecil dari fat_multiplier, max: lebih besar
    if (variant === 'min') return 1 + (fatMult - 1) * 0.5;
    if (variant === 'max') return 1 + (fatMult - 1) * 1.4;
    return fatMult;
}

function _getDatasetCorrection(dataSource, method) {
    const corrections = M.dataset_correction;

    const isFried    = ['deep_fried_naked', 'deep_fried_battered', 'deep_fried_breaded', 'geprek_penyet'].includes(method);
    const isSauteed  = ['stir_fry_light', 'stir_fry_heavy', 'pan_fried'].includes(method);

    // ── indonesian_dataset: ALREADY REALISTIC — tiny buffer only ──────────────
    // Values in indonesianFoods.js are pre-corrected toward warung reality.
    // Applying full cooking multipliers would double-count.
    if (dataSource === 'indonesian_dataset') {
        return 1.02;   // just 2% variance buffer — dataset handles the rest
    }

    // ── USDA: American lab values — Indonesian cooking uses much more oil ──────
    if (dataSource === 'usda') {
        if (isFried)   return corrections.usda.fried_items;   // 1.20
        if (isSauteed) return corrections.usda.sauteed;       // 1.15
        return corrections.usda.plain;                         // 1.00
    }

    // ── OpenFoodFacts: packaged goods — usually accurate ──────────────────────
    if (dataSource === 'openfoodfacts') {
        return corrections.openfoodfacts.packaged;             // 1.00
    }

    // ── gemini_estimate, cache: no additional dataset correction ──────────────
    return 1.00;
}

function _applyFloor(calories, foodName) {
    const name = (foodName || '').toLowerCase();
    const floors = M.indonesian_floors;

    for (const [keyword, config] of Object.entries(floors)) {
        if (name.includes(keyword.toLowerCase())) {
            if (calories < config.min_kcal_per100g) {
                return { finalCal: config.min_kcal_per100g, floorApplied: true };
            }
        }
    }

    return { finalCal: calories, floorApplied: false };
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    detectCookingMethod,
    applyCookingAdjustment,
    applyCookingAdjustmentRange,
    COOKING_KEYWORDS,  // export untuk testing
};