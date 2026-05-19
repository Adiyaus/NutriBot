// ============================================================
// src/utils/geminiCalorieBias.js
// Koreksi kalori khusus untuk estimasi Gemini (last-resort)
//
// MENGAPA MODULE INI ADA:
//   Gemini cenderung undercount kalori — terutama untuk makanan
//   berminyak, gorengan, dan fast food. Untuk calorie tracking,
//   sedikit overestimate lebih aman daripada underestimate.
//
// PRINSIP:
//   - Hanya berlaku untuk source 'gemini_estimate'
//   - USDA / local dataset / OpenFoodFacts TIDAK disentuh
//   - Bias bersifat kategorikal + keyword-based, bukan random
//   - Minimum floor per kategori makanan populer
//
// PUBLIC API:
//   applyGeminiBias(per100g, foodName) → per100g yang sudah dikoreksi
//   isHighCalorieFoodName(name)        → boolean (untuk logging/debug)
// ============================================================

// ─── KEYWORD LISTS ────────────────────────────────────────────

/**
 * Makanan berminyak / fast food / gorengan → bias +20%
 * Match: substring case-insensitive
 */
const HIGH_FAT_KEYWORDS = [
    // Gorengan & teknik masak
    'goreng', 'gorengan', 'crispy', 'krispy', 'fried', 'deep fry',
    'deep-fry', 'tempura', 'katsu', 'schnitzel',

    // Fast food & junk food
    'burger', 'cheeseburger', 'pizza', 'hot dog', 'hotdog',
    'nugget', 'nuggets', 'french fries', 'fries',

    // Makanan Indonesia tinggi lemak
    'martabak', 'martabak manis', 'martabak telur',
    'geprek', 'ayam geprek',
    'mie ayam', 'baso', 'bakso',         // kuah berlemak + minyak
    'sate', 'satay',
    'rendang',
    'gulai', 'kari', 'curry',
    'opor',
    'soto betawi',                        // santan kental
    'nasi uduk',                          // dimasak santan
    'nasi gurih',

    // Minuman manis / tinggi kalori
    'kopi susu', 'kopi gula aren', 'kopi aren',
    'boba', 'bubble tea', 'milk tea',
    'es krim', 'ice cream',
    'es teler',

    // Snack / jajanan
    'keripik', 'chips', 'crackers', 'donat', 'donut',
    'churros', 'waffle',
];

/**
 * Makanan normal → bias +10%
 * Semua makanan yang tidak masuk HIGH_FAT_KEYWORDS.
 * Tidak perlu daftar eksplisit — ini adalah default fallback.
 */

// ─── MINIMUM CALORIE FLOORS (per 100g) ───────────────────────

/**
 * Keyword → minimum kalori per 100g
 * Cegah undercount ekstrem untuk makanan dengan kalori terdefinisi tinggi.
 * Array dicheck berurutan — match pertama yang dipakai.
 */
const CALORIE_FLOORS = [
    { keywords: ['martabak'],                  minCalPer100g: 300 },
    { keywords: ['burger', 'cheeseburger'],    minCalPer100g: 250 },
    { keywords: ['ayam goreng', 'fried chicken', 'ayam geprek', 'ayam crispy'], minCalPer100g: 220 },
    { keywords: ['mie goreng', 'noodle fried', 'fried noodle', 'indomie goreng'], minCalPer100g: 180 },
    { keywords: ['rendang'],                   minCalPer100g: 190 },
    { keywords: ['sate', 'satay'],             minCalPer100g: 180 },
    { keywords: ['keripik', 'chips', 'crackers'], minCalPer100g: 450 },
    { keywords: ['donat', 'donut'],            minCalPer100g: 350 },
];

// ─── BIAS MULTIPLIERS ─────────────────────────────────────────

const BIAS_HIGH_FAT = 1.20; // +20% untuk gorengan / fast food
const BIAS_NORMAL   = 1.10; // +10% untuk makanan biasa

// ─── HELPERS ──────────────────────────────────────────────────

/**
 * Normalisasi nama makanan → lowercase, trim
 * @param {string} name
 * @returns {string}
 */
function _normalize(name) {
    return (name || '').toLowerCase().trim();
}

/**
 * Cek apakah nama makanan mengandung salah satu keyword dari list
 * @param {string} name
 * @param {string[]} keywords
 * @returns {boolean}
 */
function _hasKeyword(name, keywords) {
    const norm = _normalize(name);
    return keywords.some(kw => norm.includes(kw.toLowerCase()));
}

// ─── PUBLIC API ───────────────────────────────────────────────

/**
 * Cek apakah makanan masuk kategori high-fat/fast-food
 * Berguna untuk logging / debug di caller
 *
 * @param {string} foodName
 * @returns {boolean}
 */
function isHighCalorieFoodName(foodName) {
    return _hasKeyword(foodName, HIGH_FAT_KEYWORDS);
}

/**
 * Terapkan bias kalori Gemini ke data per100g
 * HANYA dipanggil untuk source 'gemini_estimate'
 *
 * Transformasi yang diterapkan (berurutan):
 *   1. Tentukan multiplier (HIGH_FAT +20% atau NORMAL +10%)
 *   2. Terapkan multiplier ke calories, fat, carbs, protein
 *      (protein & carbs lebih kecil efeknya, fat lebih besar)
 *   3. Terapkan minimum calorie floor
 *   4. Tambah metadata bias ke object (untuk debug/log)
 *
 * @param {{ calories_per100g, protein_per100g, carbs_per100g, fat_per100g, food_name, [key]: any }} per100g
 * @param {string} foodName - nama makanan (untuk keyword detection)
 * @returns {object} per100g yang sudah dikoreksi + field bias_applied
 */
function applyGeminiBias(per100g, foodName) {
    const name         = foodName || per100g.food_name || '';
    const isHighFat    = isHighCalorieFoodName(name);
    const multiplier   = isHighFat ? BIAS_HIGH_FAT : BIAS_NORMAL;

    // --- Apply multiplier ---
    // Fat paling responsif terhadap bias karena 9 kcal/g
    // Protein & carbs bias lebih kecil (4 kcal/g)
    const rawCal     = per100g.calories_per100g || 0;
    const rawFat     = per100g.fat_per100g      || 0;
    const rawCarbs   = per100g.carbs_per100g    || 0;
    const rawProtein = per100g.protein_per100g  || 0;

    let biasedCal     = Math.round(rawCal   * multiplier);
    let biasedFat     = parseFloat((rawFat  * multiplier).toFixed(1));

    // Karbs dan protein: bias lebih kecil (setengah dari multiplier delta)
    const macroMultiplier = 1 + (multiplier - 1) * 0.5;
    let biasedCarbs   = parseFloat((rawCarbs   * macroMultiplier).toFixed(1));
    let biasedProtein = parseFloat((rawProtein * macroMultiplier).toFixed(1));

    // --- Apply minimum floor ---
    const floorEntry = CALORIE_FLOORS.find(entry =>
        _hasKeyword(name, entry.keywords)
    );

    const floorApplied = floorEntry && biasedCal < floorEntry.minCalPer100g;
    if (floorApplied) {
        // Scale semua makro proporsional terhadap kenaikan kalori
        const floorScale  = floorEntry.minCalPer100g / biasedCal;
        biasedCal         = floorEntry.minCalPer100g;
        biasedFat         = parseFloat((biasedFat   * floorScale).toFixed(1));
        biasedCarbs       = parseFloat((biasedCarbs * floorScale).toFixed(1));
        biasedProtein     = parseFloat((biasedProtein * floorScale).toFixed(1));
    }

    const result = {
        ...per100g,
        calories_per100g: biasedCal,
        fat_per100g:      biasedFat,
        carbs_per100g:    biasedCarbs,
        protein_per100g:  biasedProtein,
        // Metadata bias — untuk debug & logging (tidak memengaruhi nutrisi)
        bias_applied: {
            category:       isHighFat ? 'high_fat' : 'normal',
            multiplier,
            floor_applied:  floorApplied,
            floor_kcal:     floorApplied ? floorEntry.minCalPer100g : null,
            original_cal:   rawCal,
            biased_cal:     biasedCal,
        },
    };

    console.log(
        `[GeminiBias] "${name}" → ` +
        `${rawCal} kcal/100g × ${multiplier}` +
        (floorApplied ? ` (floor: ${floorEntry.minCalPer100g})` : '') +
        ` = ${biasedCal} kcal/100g [${isHighFat ? 'high_fat' : 'normal'}]`
    );

    return result;
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    applyGeminiBias,
    isHighCalorieFoodName,
    // Export internal constants untuk unit testing
    HIGH_FAT_KEYWORDS,
    CALORIE_FLOORS,
    BIAS_HIGH_FAT,
    BIAS_NORMAL,
};