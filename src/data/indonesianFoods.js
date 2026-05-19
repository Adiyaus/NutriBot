// ============================================================
// src/data/indonesianFoods.js
// Dataset nutrisi makanan Indonesia lokal
//
// Sumber:
//   - TKPI 2017 (Tabel Komposisi Pangan Indonesia, Kemenkes RI)
//   - USDA FoodData Central (untuk validasi silang)
//   - Kemasan produk standar
//
// Semua nilai nutrisi adalah PER 100 GRAM bahan/makanan jadi.
//
// Keunggulan dataset ini vs USDA:
//   - Zero latency (no network call)
//   - Data spesifik Indonesia (tempe, rendang, dll)
//   - Tidak ada risiko timeout Vercel
//   - Offline-first
// ============================================================

/**
 * @typedef {Object} FoodEntry
 * @property {string[]} aliases  - semua nama yang bisa match ke entry ini
 * @property {string}   display  - nama tampilan (bahasa Indonesia)
 * @property {Object}   per100g  - nilai nutrisi per 100g
 * @property {number}   per100g.calories
 * @property {number}   per100g.protein_g
 * @property {number}   per100g.carbs_g
 * @property {number}   per100g.fat_g
 * @property {string}   source   - referensi sumber data
 */

/** @type {FoodEntry[]} */
const INDONESIAN_FOODS = [
    // ── NASI & KARBOHIDRAT ────────────────────────────────
    {
        aliases: ['nasi putih', 'steamed white rice', 'white rice', 'nasi'],
        display: 'Nasi Putih',
        per100g: { calories: 130, protein_g: 2.7, carbs_g: 28.6, fat_g: 0.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['nasi goreng', 'fried rice'],
        display: 'Nasi Goreng',
        per100g: { calories: 174, protein_g: 4.3, carbs_g: 27.4, fat_g: 5.7 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['nasi uduk', 'coconut milk rice', 'coconut rice'],
        display: 'Nasi Uduk',
        per100g: { calories: 165, protein_g: 3.2, carbs_g: 28.1, fat_g: 4.8 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['nasi kuning', 'turmeric rice'],
        display: 'Nasi Kuning',
        per100g: { calories: 160, protein_g: 3.1, carbs_g: 27.5, fat_g: 4.5 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['lontong', 'ketupat', 'compressed rice cake'],
        display: 'Lontong / Ketupat',
        per100g: { calories: 84, protein_g: 1.7, carbs_g: 18.4, fat_g: 0.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['bubur ayam', 'rice porridge chicken', 'bubur', 'rice porridge'],
        display: 'Bubur Ayam',
        per100g: { calories: 60, protein_g: 3.5, carbs_g: 8.5, fat_g: 1.5 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['mie goreng', 'fried noodles', 'mie', 'noodles'],
        display: 'Mie Goreng',
        per100g: { calories: 193, protein_g: 4.8, carbs_g: 28.5, fat_g: 7.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['mie rebus', 'boiled noodles', 'mie kuah', 'noodle soup'],
        display: 'Mie Rebus',
        per100g: { calories: 95, protein_g: 3.2, carbs_g: 17.8, fat_g: 1.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['indomie goreng', 'instant fried noodles', 'indomie'],
        display: 'Indomie Goreng (1 bungkus = 85g)',
        per100g: { calories: 389, protein_g: 9.3, carbs_g: 62.8, fat_g: 11.4 },
        source: 'Kemasan Indomie'
    },
    {
        aliases: ['indomie rebus', 'instant noodle soup', 'instant noodles'],
        display: 'Indomie Rebus (siap makan)',
        per100g: { calories: 68, protein_g: 2.5, carbs_g: 11.8, fat_g: 1.3 },
        source: 'Kemasan Indomie'
    },
    {
        aliases: ['roti tawar', 'white bread', 'bread', 'roti'],
        display: 'Roti Tawar',
        per100g: { calories: 249, protein_g: 8.0, carbs_g: 49.7, fat_g: 2.0 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['kentang goreng', 'french fries', 'fried potato'],
        display: 'Kentang Goreng',
        per100g: { calories: 274, protein_g: 3.4, carbs_g: 35.7, fat_g: 13.2 },
        source: 'USDA'
    },
    {
        aliases: ['kentang rebus', 'boiled potato', 'kentang'],
        display: 'Kentang Rebus',
        per100g: { calories: 87, protein_g: 1.9, carbs_g: 20.1, fat_g: 0.1 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['singkong rebus', 'boiled cassava', 'singkong', 'cassava'],
        display: 'Singkong Rebus',
        per100g: { calories: 154, protein_g: 1.2, carbs_g: 36.8, fat_g: 0.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['ubi rebus', 'boiled sweet potato', 'sweet potato'],
        display: 'Ubi Rebus',
        per100g: { calories: 125, protein_g: 1.6, carbs_g: 28.5, fat_g: 0.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['jagung rebus', 'boiled corn', 'jagung', 'corn'],
        display: 'Jagung Rebus',
        per100g: { calories: 96, protein_g: 3.3, carbs_g: 21.2, fat_g: 1.2 },
        source: 'TKPI 2017'
    },

    // ── AYAM ──────────────────────────────────────────────
    {
        aliases: ['ayam goreng', 'fried chicken', 'ayam'],
        display: 'Ayam Goreng',
        per100g: { calories: 297, protein_g: 25.0, carbs_g: 8.8, fat_g: 18.1 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['ayam bakar', 'grilled chicken'],
        display: 'Ayam Bakar',
        per100g: { calories: 193, protein_g: 27.4, carbs_g: 5.2, fat_g: 7.7 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['ayam rebus', 'boiled chicken'],
        display: 'Ayam Rebus',
        per100g: { calories: 168, protein_g: 28.0, carbs_g: 0.0, fat_g: 5.6 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['soto ayam', 'chicken soup', 'soto'],
        display: 'Soto Ayam',
        per100g: { calories: 52, protein_g: 4.8, carbs_g: 3.1, fat_g: 2.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['nugget ayam', 'chicken nuggets', 'nugget'],
        display: 'Nugget Ayam',
        per100g: { calories: 297, protein_g: 14.7, carbs_g: 16.9, fat_g: 18.8 },
        source: 'USDA'
    },
    {
        aliases: ['sate ayam', 'chicken satay'],
        display: 'Sate Ayam (tanpa bumbu)',
        per100g: { calories: 195, protein_g: 22.8, carbs_g: 0.5, fat_g: 11.2 },
        source: 'TKPI 2017'
    },

    // ── DAGING SAPI & OLAHAN ──────────────────────────────
    {
        aliases: ['daging sapi', 'beef'],
        display: 'Daging Sapi (dimasak)',
        per100g: { calories: 218, protein_g: 26.1, carbs_g: 0.0, fat_g: 12.1 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['rendang', 'beef rendang'],
        display: 'Rendang Daging',
        per100g: { calories: 193, protein_g: 19.9, carbs_g: 6.7, fat_g: 9.8 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['bakso', 'bakso sapi', 'meatball soup', 'beef meatball'],
        display: 'Bakso',
        per100g: { calories: 83, protein_g: 8.6, carbs_g: 6.3, fat_g: 2.7 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['sate sapi', 'beef satay'],
        display: 'Sate Sapi',
        per100g: { calories: 210, protein_g: 23.5, carbs_g: 0.5, fat_g: 12.5 },
        source: 'TKPI 2017'
    },

    // ── IKAN & SEAFOOD ────────────────────────────────────
    {
        aliases: ['ikan goreng', 'fried fish'],
        display: 'Ikan Goreng',
        per100g: { calories: 195, protein_g: 27.3, carbs_g: 3.6, fat_g: 7.8 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['ikan bakar', 'grilled fish'],
        display: 'Ikan Bakar',
        per100g: { calories: 137, protein_g: 26.0, carbs_g: 1.8, fat_g: 2.7 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['ikan salmon', 'salmon'],
        display: 'Ikan Salmon',
        per100g: { calories: 208, protein_g: 20.4, carbs_g: 0.0, fat_g: 13.4 },
        source: 'USDA'
    },
    {
        aliases: ['ikan tuna', 'ikan tongkol', 'tuna', 'canned tuna'],
        display: 'Ikan Tuna / Tongkol',
        per100g: { calories: 132, protein_g: 28.9, carbs_g: 0.0, fat_g: 1.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['udang goreng', 'fried shrimp', 'udang', 'shrimp'],
        display: 'Udang Goreng',
        per100g: { calories: 143, protein_g: 19.6, carbs_g: 5.4, fat_g: 4.6 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['cumi goreng', 'fried squid', 'squid'],
        display: 'Cumi Goreng',
        per100g: { calories: 175, protein_g: 15.3, carbs_g: 8.1, fat_g: 8.4 },
        source: 'TKPI 2017'
    },

    // ── TELUR ─────────────────────────────────────────────
    {
        aliases: ['telur goreng', 'fried egg', 'telur ceplok', 'telur mata sapi'],
        display: 'Telur Goreng',
        per100g: { calories: 195, protein_g: 13.6, carbs_g: 0.9, fat_g: 15.4 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['telur dadar', 'egg omelette', 'omelette'],
        display: 'Telur Dadar',
        per100g: { calories: 175, protein_g: 11.8, carbs_g: 1.5, fat_g: 13.6 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['telur rebus', 'boiled egg', 'telur', 'egg'],
        display: 'Telur Rebus',
        per100g: { calories: 154, protein_g: 12.6, carbs_g: 1.1, fat_g: 10.6 },
        source: 'TKPI 2017'
    },

    // ── TEMPE & TAHU ──────────────────────────────────────
    {
        aliases: ['tempe goreng', 'fried tempeh', 'tempe'],
        display: 'Tempe Goreng',
        per100g: { calories: 227, protein_g: 18.3, carbs_g: 13.5, fat_g: 11.4 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['tempe bacem', 'braised tempeh'],
        display: 'Tempe Bacem',
        per100g: { calories: 185, protein_g: 14.6, carbs_g: 17.2, fat_g: 6.8 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['tahu goreng', 'fried tofu', 'tofu fried'],
        display: 'Tahu Goreng',
        per100g: { calories: 128, protein_g: 8.9, carbs_g: 5.2, fat_g: 8.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['tahu rebus', 'tahu', 'tofu', 'boiled tofu'],
        display: 'Tahu Rebus',
        per100g: { calories: 68, protein_g: 7.8, carbs_g: 1.6, fat_g: 3.7 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['tahu bacem', 'braised tofu'],
        display: 'Tahu Bacem',
        per100g: { calories: 97, protein_g: 8.6, carbs_g: 8.0, fat_g: 3.5 },
        source: 'TKPI 2017'
    },

    // ── SAYURAN ───────────────────────────────────────────
    {
        aliases: ['tumis kangkung', 'stir fried water spinach', 'kangkung'],
        display: 'Tumis Kangkung',
        per100g: { calories: 58, protein_g: 2.4, carbs_g: 5.3, fat_g: 3.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['tumis bayam', 'stir fried spinach', 'bayam'],
        display: 'Tumis Bayam',
        per100g: { calories: 65, protein_g: 2.8, carbs_g: 5.8, fat_g: 3.5 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['sayur sop', 'vegetable soup'],
        display: 'Sayur Sop',
        per100g: { calories: 38, protein_g: 1.9, carbs_g: 5.3, fat_g: 1.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['sayur lodeh', 'vegetable coconut milk soup'],
        display: 'Sayur Lodeh',
        per100g: { calories: 62, protein_g: 1.5, carbs_g: 5.8, fat_g: 3.8 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['gado gado', 'gado-gado', 'vegetable salad peanut sauce'],
        display: 'Gado-Gado',
        per100g: { calories: 132, protein_g: 5.8, carbs_g: 12.5, fat_g: 7.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['cap cay', 'capcay', 'chinese stir fry vegetables'],
        display: 'Cap Cay',
        per100g: { calories: 72, protein_g: 3.5, carbs_g: 6.8, fat_g: 3.5 },
        source: 'TKPI 2017'
    },

    // ── JAJANAN & GORENGAN ────────────────────────────────
    {
        aliases: ['pisang goreng', 'fried banana'],
        display: 'Pisang Goreng',
        per100g: { calories: 246, protein_g: 1.6, carbs_g: 38.2, fat_g: 10.1 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['bakwan', 'vegetable fritter'],
        display: 'Bakwan',
        per100g: { calories: 224, protein_g: 4.5, carbs_g: 26.7, fat_g: 11.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['martabak', 'stuffed pancake'],
        display: 'Martabak',
        per100g: { calories: 256, protein_g: 7.2, carbs_g: 28.3, fat_g: 13.1 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['siomay', 'steamed fish dumpling'],
        display: 'Siomay',
        per100g: { calories: 116, protein_g: 8.6, carbs_g: 12.3, fat_g: 3.8 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['batagor', 'fried fish dumpling'],
        display: 'Batagor',
        per100g: { calories: 183, protein_g: 9.4, carbs_g: 15.2, fat_g: 9.3 },
        source: 'TKPI 2017'
    },

    // ── BUAH ──────────────────────────────────────────────
    {
        aliases: ['pisang', 'banana'],
        display: 'Pisang',
        per100g: { calories: 99, protein_g: 1.2, carbs_g: 25.8, fat_g: 0.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['apel', 'apple'],
        display: 'Apel',
        per100g: { calories: 58, protein_g: 0.3, carbs_g: 14.9, fat_g: 0.4 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['jeruk', 'orange'],
        display: 'Jeruk',
        per100g: { calories: 45, protein_g: 0.9, carbs_g: 11.2, fat_g: 0.2 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['semangka', 'watermelon'],
        display: 'Semangka',
        per100g: { calories: 28, protein_g: 0.6, carbs_g: 6.9, fat_g: 0.1 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['mangga', 'mango'],
        display: 'Mangga',
        per100g: { calories: 65, protein_g: 0.7, carbs_g: 16.9, fat_g: 0.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['alpukat', 'avocado'],
        display: 'Alpukat',
        per100g: { calories: 160, protein_g: 2.0, carbs_g: 8.5, fat_g: 14.7 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['pepaya', 'papaya'],
        display: 'Pepaya',
        per100g: { calories: 40, protein_g: 0.6, carbs_g: 9.8, fat_g: 0.1 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['durian'],
        display: 'Durian',
        per100g: { calories: 147, protein_g: 1.5, carbs_g: 27.1, fat_g: 5.3 },
        source: 'TKPI 2017'
    },

    // ── MINUMAN ───────────────────────────────────────────
    {
        aliases: ['susu sapi', 'susu', 'milk', 'whole milk'],
        display: 'Susu Sapi',
        per100g: { calories: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3 },
        source: 'TKPI 2017'
    },
    {
        aliases: ['kopi susu', 'coffee with milk'],
        display: 'Kopi Susu (tanpa gula)',
        per100g: { calories: 30, protein_g: 1.8, carbs_g: 2.7, fat_g: 1.5 },
        source: 'Estimasi'
    },
    {
        aliases: ['teh manis', 'es teh', 'sweet tea', 'iced tea'],
        display: 'Teh Manis',
        per100g: { calories: 36, protein_g: 0.0, carbs_g: 9.0, fat_g: 0.0 },
        source: 'TKPI 2017'
    },
];

// ─── LOOKUP ENGINE ────────────────────────────────────────────

/**
 * Cari makanan di local dataset berdasarkan nama
 * Return entry pertama yang cocok, atau null
 *
 * @param {string} foodName - normalized food name (dari normalizeFood)
 * @returns {FoodEntry|null}
 */
function findFood(foodName) {
    if (!foodName) return null;

    const query = foodName.toLowerCase().trim();

    // 1. Exact match di aliases
    for (const entry of INDONESIAN_FOODS) {
        if (entry.aliases.some(alias => alias === query)) {
            return entry;
        }
    }

    // 2. Partial match — query contains alias OR alias contains query
    for (const entry of INDONESIAN_FOODS) {
        if (entry.aliases.some(alias =>
            query.includes(alias) || alias.includes(query)
        )) {
            return entry;
        }
    }

    return null;
}

/**
 * Convert FoodEntry ke format NutriBot standar (per100g object)
 *
 * @param {FoodEntry} entry
 * @returns {{ calories_per100g, protein_per100g, carbs_per100g, fat_per100g, data_source, confidence }}
 */
function toNutriFormat(entry) {
    return {
        calories_per100g: entry.per100g.calories,
        protein_per100g:  entry.per100g.protein_g,
        carbs_per100g:    entry.per100g.carbs_g,
        fat_per100g:      entry.per100g.fat_g,
        food_name:        entry.display,
        data_source:      'indonesian_dataset',
        confidence:       'high',
    };
}

module.exports = {
    INDONESIAN_FOODS,
    findFood,
    toNutriFormat,
};