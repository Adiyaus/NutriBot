// ============================================================
// src/engine/portionScaling.js
// Layer 3: Portion Size Correction
//
// MASALAH YANG DIPECAHKAN:
//   Gemini vision mengestimasi porsi berdasarkan "serving size ideal" —
//   biasanya lebih kecil dari yang sebenarnya disajikan di warung/restoran.
//
//   Contoh konkrit (foto meja warung Surabaya):
//     Gemini: "steamed white rice 200g"  → realita: 280-320g
//     Gemini: "fried chicken 80g"        → realita: 100-130g (potong paha besar)
//     Gemini: "fried rice 250g"          → realita: 350-450g (nasi goreng warung full)
//
//   Gap ini = 30-50% undercounting dari porsi saja.
//
// PENDEKATAN:
//   1. Deteksi kategori makanan & konteks tempat (warung/restoran/fast food)
//   2. Apply portion scaling factor dari realisticMultipliers.js
//   3. Return adjusted portion_g + metadata
//
// CATATAN:
//   - Scaling ini intentionally generous — better to slightly overcount
//     untuk dieting accuracy (lebih aman bagi user yang sedang diet)
//   - Bisa di-disable per item kalau user memberikan berat eksplisit ("300 gram")
// ============================================================

const M = require('../config/realisticMultipliers');

// ─── FOOD CONTEXT KEYWORDS ────────────────────────────────────
// Deteksi jenis tempat/konteks dari nama makanan

const CONTEXT_KEYWORDS = [

    // Rice-specific scaling (nasi warung lebih banyak dari standar)
    {
        context: 'rice_warung',
        scaling: M.portion.rice_warung,
        keywords: [
            'nasi goreng', 'nasi uduk', 'nasi kuning', 'nasi padang',
            'nasi campur', 'nasi rawon', 'nasi bakar', 'nasi pecel',
            'fried rice', 'steamed rice', 'white rice',
            // Catatan: "nasi putih polos" (plain steamed rice) masuk sini juga
            // karena warung selalu lebih banyak
        ],
    },

    // Fast food chains
    {
        context: 'fast_food_chain',
        scaling: M.portion.fast_food_chain,
        keywords: [
            'kfc', 'mcdonald', 'mcdonalds', 'burger king', 'wendy', 'popeye',
            'pizza hut', 'domino', 'j.co', 'jco', 'krispy kreme', 'dunkin',
            'subway', 'a&w', 'richeese', 'geprek bensu', 'bensu',
            'burger', 'nugget', 'french fries', 'fried chicken crispy',
            'hot dog', 'pizza',
        ],
    },

    // Street food / jajanan
    {
        context: 'street_food',
        scaling: M.portion.street_food,
        keywords: [
            'bakso', 'siomay', 'batagor', 'cilok', 'cireng',
            'martabak', 'pisang goreng', 'bakwan', 'tempe mendoan',
            'risol', 'lumpia', 'gorengan', 'sate', 'satay',
            'ketoprak', 'gado gado', 'pecel', 'lotek',
            'es teler', 'es cendol', 'es campur',
        ],
    },

    // Warung / warteg — general flag untuk makanan Indonesia tanpa konteks spesifik
    {
        context: 'warung_warteg',
        scaling: M.portion.warung_warteg,
        keywords: [
            // Lauk pauk warung umum
            'ayam goreng', 'ayam bakar', 'ikan goreng', 'tempe goreng',
            'tahu goreng', 'rendang', 'semur', 'balado',
            'opor', 'gulai', 'soto', 'rawon', 'cap cay',
            'tumis kangkung', 'tumis bayam', 'sayur sop',
            'mie goreng', 'mie rebus', 'mie ayam',
            // English equivalents
            'grilled chicken', 'fried fish', 'fried tofu', 'fried tempeh',
            'beef rendang', 'chicken satay', 'beef satay',
            'stir fried', 'noodle soup', 'chicken soup',
        ],
    },

    // Restaurant Indonesia (Padang, Sundanese, dll)
    {
        context: 'restaurant_indonesia',
        scaling: M.portion.restaurant_indonesia,
        keywords: [
            'padang', 'sunda', 'minang', 'jawa', 'solo', 'yogya',
            'masakan indonesia', 'indonesian',
        ],
    },
];

// Foods where user explicitly mentioned portion → skip scaling
const EXPLICIT_PORTION_SIGNALS = [
    // Angka + satuan langsung → Gemini sudah pakai ini
    // Ditandai oleh Gemini notes atau food_description yang menyebut ukuran eksplisit
];

// ─── MINIMUM / MAXIMUM PORTION GUARDS ────────────────────────
// Prevent extreme outliers

const PORTION_GUARDS = {
    // Per food type: [min_g, max_g]
    'steamed white rice':    [100, 500],
    'fried rice':            [150, 600],
    'fried chicken':         [50,  300],
    'noodles':               [100, 500],
    'egg':                   [40,  120],
    'tempe':                 [20,  200],
    'tofu':                  [30,  200],
    'vegetable':             [30,  300],
    'soup':                  [100, 600],
    'banana':                [80,  200],
    'default':               [10,  1500],
};

// ─── CORE FUNCTIONS ───────────────────────────────────────────

/**
 * Deteksi konteks porsi dari nama makanan
 *
 * @param {string} foodName
 * @param {string} [userContext] - konteks dari user (misal: "di warteg", "KFC")
 * @returns {{ context: string, scaling: object, confidence: string }}
 */
function detectPortionContext(foodName, userContext = '') {
    const combined = `${foodName} ${userContext}`.toLowerCase();

    for (const { context, scaling, keywords } of CONTEXT_KEYWORDS) {
        const matched = keywords.find(kw => combined.includes(kw.toLowerCase()));
        if (matched) {
            return { context, scaling, matched_keyword: matched, confidence: 'high' };
        }
    }

    // Default: asumsi home cooked (paling konservatif)
    return {
        context: 'home_cooked',
        scaling: M.portion.home_cooked,
        matched_keyword: null,
        confidence: 'low',
    };
}

/**
 * Apply portion scaling ke portion_g
 *
 * @param {number} portionG - estimasi Gemini (gram)
 * @param {string} foodName
 * @param {string} [userContext]
 * @param {string} [variant='mid'] - 'min', 'mid', 'max'
 * @param {boolean} [userExplicitPortion=false] - kalau user specify berat eksplisit
 * @returns {{ adjusted_portion_g: number, original_portion_g: number, context: string, scaling_applied: boolean }}
 */
function applyPortionScaling(portionG, foodName, userContext = '', variant = 'mid', userExplicitPortion = false) {
    // Kalau user kasih berat eksplisit, jangan scale
    if (userExplicitPortion) {
        return {
            adjusted_portion_g: portionG,
            original_portion_g: portionG,
            context: 'user_explicit',
            scaling_applied: false,
            scale_factor: 1.0,
        };
    }

    const { context, scaling, matched_keyword, confidence } = detectPortionContext(foodName, userContext);

    // Pilih scale factor
    let scaleFactor;
    if (variant === 'min')      scaleFactor = scaling.min;
    else if (variant === 'max') scaleFactor = scaling.max;
    else                        scaleFactor = scaling.mid;

    const rawAdjusted = portionG * scaleFactor;

    // Apply guards
    const guardKey = _findGuardKey(foodName);
    const [guardMin, guardMax] = PORTION_GUARDS[guardKey] || PORTION_GUARDS['default'];
    const adjusted = Math.round(Math.min(Math.max(rawAdjusted, guardMin), guardMax));

    return {
        adjusted_portion_g: adjusted,
        original_portion_g: portionG,
        context,
        matched_keyword,
        scaling_applied: true,
        scale_factor: scaleFactor,
        scale_confidence: confidence,
    };
}

/**
 * Apply scaling untuk semua 3 variants sekaligus
 *
 * @param {number} portionG
 * @param {string} foodName
 * @param {string} [userContext]
 * @param {boolean} [userExplicitPortion=false]
 * @returns {{ conservative_g, mid_g, upper_g, context, scale_factor_mid }}
 */
function applyPortionScalingRange(portionG, foodName, userContext = '', userExplicitPortion = false) {
    const conservative = applyPortionScaling(portionG, foodName, userContext, 'min', userExplicitPortion);
    const mid          = applyPortionScaling(portionG, foodName, userContext, 'mid', userExplicitPortion);
    const upper        = applyPortionScaling(portionG, foodName, userContext, 'max', userExplicitPortion);

    return {
        conservative_g:   conservative.adjusted_portion_g,
        mid_g:            mid.adjusted_portion_g,
        upper_g:          upper.adjusted_portion_g,
        original_g:       portionG,
        context:          mid.context,
        matched_keyword:  mid.matched_keyword,
        scale_factor_mid: mid.scale_factor,
        scaling_applied:  mid.scaling_applied,
    };
}

/**
 * Tambah calorie estimate untuk invisible components
 * (sambal, kecap, sauce yang tidak terdeteksi Gemini)
 *
 * @param {string} foodName
 * @param {string} mealDescription - deskripsi keseluruhan makan
 * @returns {{ extra_kcal: number, components: string[] }}
 */
function estimateInvisibleCalories(foodName, mealDescription = '') {
    const combined = `${foodName} ${mealDescription}`.toLowerCase();
    const components = [];
    let extra_kcal = 0;

    const inv = M.invisible;

    // Sambal (hampir selalu ada di makanan Indonesia)
    if (_isIndonesianFood(combined)) {
        extra_kcal += inv.sambal_per_sdm_kcal * inv.sambal_default_sdm;
        components.push(`sambal (~${Math.round(inv.sambal_per_sdm_kcal * inv.sambal_default_sdm)} kcal)`);
    }

    // Kecap manis (sate, bakso, nasi goreng)
    if (combined.match(/sate|satay|bakso|nasi goreng|fried rice/)) {
        extra_kcal += inv.kecap_per_sdm_kcal * inv.kecap_default_sdm;
        components.push(`kecap manis (~${inv.kecap_per_sdm_kcal} kcal)`);
    }

    // Visible sauce (terlihat di foto tapi bukan item tersendiri)
    if (combined.match(/sauce|saus|kuah/)) {
        extra_kcal += inv.sauce_visible_kcal;
        components.push(`saus/kuah (~${inv.sauce_visible_kcal} kcal)`);
    }

    // Butter/margarin untuk roti
    if (combined.match(/roti|toast|bread|sandwich/)) {
        extra_kcal += inv.butter_per_slice_kcal;
        components.push(`margarin (~${inv.butter_per_slice_kcal} kcal)`);
    }

    return {
        extra_kcal: Math.round(extra_kcal),
        components,
    };
}

// ─── HELPERS ──────────────────────────────────────────────────

function _findGuardKey(foodName) {
    const name = (foodName || '').toLowerCase();
    for (const key of Object.keys(PORTION_GUARDS)) {
        if (key !== 'default' && name.includes(key)) return key;
    }
    return 'default';
}

function _isIndonesianFood(name) {
    const indonesianKeywords = [
        'nasi', 'mie', 'ayam', 'ikan', 'tempe', 'tahu', 'bakso',
        'soto', 'rendang', 'gado', 'sate', 'sambal', 'cap cay',
        'indonesian', 'rice', 'fried rice', 'fried chicken',
        'stir fry', 'stir fried',
    ];
    return indonesianKeywords.some(kw => name.includes(kw));
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    detectPortionContext,
    applyPortionScaling,
    applyPortionScalingRange,
    estimateInvisibleCalories,
};