// ============================================================
// src/utils/geminicaloriebias.js — REVISED v2
// Koreksi kalori khusus untuk estimasi Gemini (last-resort)
//
// CATATAN ARSITEKTUR:
//   File ini HANYA berlaku untuk source 'gemini_estimate'.
//   Untuk semua sumber lain, koreksi ditangani di:
//     → src/engine/cookingAdjustment.js  (dataset_correction)
//     → src/config/realisticMultipliers.js (indonesian_floors)
//
// PERUBAHAN DARI v1:
//   • Multiplier HIGH_FAT naik: 1.20 → 1.28 (lab vs warung gap nyata)
//   • Multiplier NORMAL naik:   1.10 → 1.15 (semua makanan dimasak lebih berminyak)
//   • Tambah kategori: SANTAN, FAST_FOOD_ID, GORENGAN_BATTER
//   • Floor diperluas: tambah rendang, soto betawi, martabak manis, dll
//   • Fat multiplier lebih agresif (fat most affected by extra oil)
// ============================================================

// ─── KEYWORD CATEGORIES ───────────────────────────────────────

/** ULTRA HIGH FAT: goreng batter tebal / fast food / santan kental → bias +35% */
const ULTRA_HIGH_FAT_KEYWORDS = [
    'martabak', 'martabak manis', 'martabak telur',
    'mendoan', 'bakwan', 'pisang goreng', 'batagor',
    'soto betawi',
    'opor', 'gulai',
    'kfc', 'fried chicken crispy', 'ayam crispy',
    'geprek', 'penyet',
    'es krim', 'ice cream',
    'donat', 'donut',
    'boba', 'bubble tea',
];

/** HIGH FAT: gorengan biasa / fast food / santan → bias +22% */
const HIGH_FAT_KEYWORDS = [
    // Teknik masak tinggi lemak
    'goreng', 'gorengan', 'crispy', 'krispy', 'fried', 'deep fry', 'deep-fry',
    'tempura', 'katsu', 'schnitzel',

    // Fast food
    'burger', 'cheeseburger', 'pizza', 'hot dog', 'hotdog',
    'nugget', 'nuggets', 'french fries', 'fries',

    // Indonesian tinggi lemak
    'rendang', 'kari', 'curry',
    'nasi uduk', 'nasi gurih',
    'mie goreng', 'nasi goreng', 'fried rice', 'fried noodle',
    'sate', 'satay',

    // Minuman tinggi kalori
    'kopi susu', 'kopi gula aren', 'kopi aren',
    'milk tea',
    'es teler',

    // Snack
    'keripik', 'chips', 'crackers', 'churros', 'waffle',
];

/** MEDIUM FAT: masakan berminyak sedang, santan encer → bias +15% */
const MEDIUM_FAT_KEYWORDS = [
    'tumis', 'stir fry', 'stir-fry', 'oseng', 'cap cay',
    'semur', 'balado', 'rica rica',
    'ayam bakar', 'grilled chicken', 'sate ayam',
    'bakso', 'meatball',
];

// ─── MINIMUM CALORIE FLOORS (per 100g) ───────────────────────
// Cegah undercount ekstrem untuk makanan dengan kalori pasti tinggi

const CALORIE_FLOORS = [
    // Santan kental
    { keywords: ['soto betawi'],                    minCalPer100g: 155 },
    { keywords: ['opor ayam', 'opor'],              minCalPer100g: 130 },
    { keywords: ['gulai'],                          minCalPer100g: 130 },

    // Gorengan batter
    { keywords: ['martabak manis', 'terang bulan'], minCalPer100g: 330 },
    { keywords: ['martabak telur'],                 minCalPer100g: 280 },
    { keywords: ['martabak'],                       minCalPer100g: 280 },
    { keywords: ['mendoan', 'tempe mendoan'],       minCalPer100g: 240 },
    { keywords: ['pisang goreng'],                  minCalPer100g: 260 },
    { keywords: ['bakwan'],                         minCalPer100g: 235 },

    // Ayam goreng
    { keywords: ['ayam geprek', 'geprek'],          minCalPer100g: 270 },
    { keywords: ['ayam penyet', 'penyet'],          minCalPer100g: 260 },
    { keywords: ['ayam crispy', 'crispy chicken'],  minCalPer100g: 295 },
    { keywords: ['ayam goreng', 'fried chicken'],   minCalPer100g: 280 },

    // Fast food
    { keywords: ['burger', 'cheeseburger'],         minCalPer100g: 255 },
    { keywords: ['french fries', 'kentang goreng'], minCalPer100g: 285 },
    { keywords: ['nugget'],                         minCalPer100g: 290 },

    // Nasi/mie
    { keywords: ['nasi goreng', 'fried rice'],      minCalPer100g: 185 },
    { keywords: ['mie goreng', 'fried noodles'],    minCalPer100g: 200 },
    { keywords: ['nasi uduk'],                      minCalPer100g: 175 },
    { keywords: ['rendang'],                        minCalPer100g: 240 },

    // Snack
    { keywords: ['keripik', 'chips', 'crackers'],  minCalPer100g: 460 },
    { keywords: ['donat', 'donut'],                minCalPer100g: 370 },
    { keywords: ['boba', 'bubble tea'],            minCalPer100g: 85 },  // per 100ml

    // Saus
    { keywords: ['bumbu kacang', 'peanut sauce'],  minCalPer100g: 360 },
    { keywords: ['salted egg sauce', 'saus telur asin'], minCalPer100g: 270 },
];

// ─── BIAS MULTIPLIERS ─────────────────────────────────────────

const BIAS_ULTRA_HIGH_FAT = 1.35;  // +35%: batter/santan kental/fast food heavy
const BIAS_HIGH_FAT       = 1.28;  // +28%: gorengan biasa, fast food, santan
const BIAS_MEDIUM_FAT     = 1.18;  // +18%: tumis, bumbu
const BIAS_NORMAL         = 1.12;  // +12%: makanan lain (semua masakan = lebih berminyak dari lab)

// ─── HELPERS ──────────────────────────────────────────────────

function _normalize(name) {
    return (name || '').toLowerCase().trim();
}

function _hasKeyword(name, keywords) {
    const norm = _normalize(name);
    return keywords.some(kw => norm.includes(kw.toLowerCase()));
}

function _detectCategory(name) {
    if (_hasKeyword(name, ULTRA_HIGH_FAT_KEYWORDS)) return 'ultra_high_fat';
    if (_hasKeyword(name, HIGH_FAT_KEYWORDS))       return 'high_fat';
    if (_hasKeyword(name, MEDIUM_FAT_KEYWORDS))     return 'medium_fat';
    return 'normal';
}

function _getMultiplier(category) {
    switch (category) {
        case 'ultra_high_fat': return BIAS_ULTRA_HIGH_FAT;
        case 'high_fat':       return BIAS_HIGH_FAT;
        case 'medium_fat':     return BIAS_MEDIUM_FAT;
        default:               return BIAS_NORMAL;
    }
}

// ─── PUBLIC API ───────────────────────────────────────────────

/**
 * Cek kategori kalori dari nama makanan
 * @param {string} foodName
 * @returns {'ultra_high_fat'|'high_fat'|'medium_fat'|'normal'}
 */
function getFoodCategory(foodName) {
    return _detectCategory(foodName);
}

/**
 * Cek apakah makanan masuk kategori high-fat (backward compat)
 * @param {string} foodName
 * @returns {boolean}
 */
function isHighCalorieFoodName(foodName) {
    const cat = _detectCategory(foodName);
    return cat === 'high_fat' || cat === 'ultra_high_fat';
}

/**
 * Terapkan bias kalori Gemini ke data per100g
 * HANYA dipanggil untuk source 'gemini_estimate'
 *
 * Transformasi (berurutan):
 *   1. Deteksi kategori (ultra_high_fat / high_fat / medium_fat / normal)
 *   2. Terapkan multiplier ke calories + fat (fat lebih agresif)
 *   3. Terapkan minimum calorie floor
 *   4. Sesuaikan carbs & protein proporsional (tapi lebih kecil dari fat)
 *
 * @param {object} per100g
 * @param {string} foodName
 * @returns {object} per100g yang sudah dikoreksi
 */
function applyGeminiBias(per100g, foodName) {
    const name       = foodName || per100g.food_name || '';
    const category   = _detectCategory(name);
    const multiplier = _getMultiplier(category);

    const rawCal     = per100g.calories_per100g || 0;
    const rawFat     = per100g.fat_per100g      || 0;
    const rawCarbs   = per100g.carbs_per100g    || 0;
    const rawProtein = per100g.protein_per100g  || 0;

    // Fat paling terpengaruh (9 kcal/g dari minyak)
    // Gunakan fat_multiplier lebih agresif (120-150% dari cal multiplier delta)
    const fatMultDelta = (multiplier - 1) * 1.4;
    const fatMult      = 1 + Math.min(fatMultDelta, 0.70); // cap 70% max

    let biasedCal     = Math.round(rawCal * multiplier);
    let biasedFat     = parseFloat((rawFat * fatMult).toFixed(1));

    // Carbs & protein: lebih kecil (minyak ekstra tidak langsung ubah ini)
    const macroMult   = 1 + (multiplier - 1) * 0.35;
    let biasedCarbs   = parseFloat((rawCarbs   * macroMult).toFixed(1));
    let biasedProtein = parseFloat((rawProtein * 1.00).toFixed(1)); // protein tidak berubah

    // Apply calorie floor
    const floorEntry = CALORIE_FLOORS.find(entry =>
        _hasKeyword(name, entry.keywords)
    );

    const floorApplied = floorEntry && biasedCal < floorEntry.minCalPer100g;
    if (floorApplied) {
        const floorScale  = floorEntry.minCalPer100g / Math.max(biasedCal, 1);
        biasedCal         = floorEntry.minCalPer100g;
        biasedFat         = parseFloat((biasedFat   * floorScale).toFixed(1));
        biasedCarbs       = parseFloat((biasedCarbs * floorScale).toFixed(1));
        // protein tidak di-scale dengan floor
    }

    const result = {
        ...per100g,
        calories_per100g: biasedCal,
        fat_per100g:      biasedFat,
        carbs_per100g:    biasedCarbs,
        protein_per100g:  biasedProtein,
        bias_applied: {
            category,
            multiplier,
            fat_multiplier:   fatMult,
            floor_applied:    floorApplied,
            floor_kcal:       floorApplied ? floorEntry.minCalPer100g : null,
            original_cal:     rawCal,
            biased_cal:       biasedCal,
        },
    };

    console.log(
        `[GeminiBias] "${name}" → ` +
        `${rawCal} kcal/100g × ${multiplier} [${category}]` +
        (floorApplied ? ` (floor: ${floorEntry.minCalPer100g})` : '') +
        ` = ${biasedCal} kcal/100g`
    );

    return result;
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    applyGeminiBias,
    isHighCalorieFoodName,
    getFoodCategory,
    // Export internal constants untuk unit testing
    ULTRA_HIGH_FAT_KEYWORDS,
    HIGH_FAT_KEYWORDS,
    MEDIUM_FAT_KEYWORDS,
    CALORIE_FLOORS,
    BIAS_ULTRA_HIGH_FAT,
    BIAS_HIGH_FAT,
    BIAS_MEDIUM_FAT,
    BIAS_NORMAL,
};