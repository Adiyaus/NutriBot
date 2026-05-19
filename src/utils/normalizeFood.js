// ============================================================
// src/utils/normalizeFood.js
// Normalize food names → consistent cache keys & API lookups
//
// Why this matters:
//   "Nasi Goreng 1 Porsi" vs "nasi goreng" vs "fried rice"
//   → semua harus resolve ke key yang sama di cache
// ============================================================

// ─── STOPWORDS ────────────────────────────────────────────────
// Kata-kata yang dibuang sebelum normalisasi — bukan bagian dari nama makanan

const STOPWORDS = new Set([
    // Satuan porsi
    'porsi', 'piring', 'mangkok', 'mangkuk', 'gelas', 'cangkir',
    'sendok', 'sdm', 'sdt', 'sachet', 'bungkus', 'kotak', 'pak',
    'buah', 'potong', 'iris', 'lembar', 'batang', 'ikat', 'biji',
    'centong', 'centong', 'loyang', 'cup', 'slice', 'piece', 'serving',
    // Satuan berat/volume
    'gram', 'gr', 'g', 'kg', 'ml', 'liter', 'l',
    // Ukuran
    'kecil', 'sedang', 'besar', 'small', 'medium', 'large',
    'setengah', 'seperempat', 'half',
    // Kata penghubung
    'dan', 'dengan', 'plus', 'tambah', 'and', 'with',
    // Angka kata
    'satu', 'dua', 'tiga', 'empat', 'lima',
    'one', 'two', 'three', 'four', 'five',
]);

// ─── ID → ENGLISH DICTIONARY ─────────────────────────────────
// Nama Indonesia → English untuk USDA / OpenFoodFacts lookup

const ID_TO_EN = {
    // Nasi & Karbohidrat
    'nasi putih':         'steamed white rice',
    'nasi goreng':        'fried rice',
    'nasi uduk':          'coconut milk rice',
    'nasi kuning':        'turmeric rice',
    'nasi padang':        'steamed white rice',
    'nasi campur':        'mixed rice',
    'nasi rawon':         'steamed white rice',
    'lontong':            'compressed rice cake',
    'ketupat':            'compressed rice cake',
    'bubur ayam':         'rice porridge chicken',
    'bubur':              'rice porridge',
    'mie goreng':         'fried noodles',
    'mie rebus':          'boiled noodles',
    'mie ayam':           'chicken noodle soup',
    'mie kuah':           'noodle soup',
    'mie':                'noodles',
    'kwetiau goreng':     'stir fried flat rice noodles',
    'bihun goreng':       'fried rice vermicelli',
    'roti tawar':         'white bread',
    'roti':               'bread',
    'kentang goreng':     'french fries',
    'kentang rebus':      'boiled potato',
    'kentang':            'potato',
    'singkong rebus':     'boiled cassava',
    'singkong':           'cassava',
    'ubi rebus':          'boiled sweet potato',
    'jagung rebus':       'boiled corn',
    'jagung':             'corn',

    // Lauk Hewani
    'ayam goreng':        'fried chicken',
    'ayam bakar':         'grilled chicken',
    'ayam rebus':         'boiled chicken',
    'ayam geprek':        'smashed fried chicken',
    'ayam penyet':        'smashed fried chicken',
    'daging sapi':        'beef',
    'rendang':            'beef rendang',
    'rawon':              'black beef soup',
    'soto ayam':          'chicken soup',
    'soto':               'indonesian beef soup',
    'opor ayam':          'chicken in coconut milk',
    'semur ayam':         'braised chicken',
    'ikan goreng':        'fried fish',
    'ikan bakar':         'grilled fish',
    'ikan salmon':        'salmon',
    'ikan tongkol':       'canned tuna',
    'ikan tuna':          'tuna',
    'udang goreng':       'fried shrimp',
    'udang rebus':        'boiled shrimp',
    'udang':              'shrimp',
    'cumi goreng':        'fried squid',
    'telur goreng':       'fried egg',
    'telur ceplok':       'fried egg',
    'telur dadar':        'egg omelette',
    'telur rebus':        'boiled egg',
    'telur':              'egg',
    'bakso':              'meatball soup',
    'bakso sapi':         'beef meatball',
    'sate ayam':          'chicken satay',
    'sate sapi':          'beef satay',
    'sate':               'satay',

    // Lauk Nabati
    'tempe goreng':       'fried tempeh',
    'tempe bacem':        'braised tempeh',
    'tempe':              'tempeh',
    'tahu goreng':        'fried tofu',
    'tahu bacem':         'braised tofu',
    'tahu':               'tofu',
    'oncom':              'fermented soybean cake',

    // Sayuran
    'tumis kangkung':     'stir fried water spinach',
    'tumis bayam':        'stir fried spinach',
    'tumis buncis':       'stir fried green beans',
    'sayur sop':          'vegetable soup',
    'sayur lodeh':        'vegetable coconut milk soup',
    'cap cay':            'chinese stir fry vegetables',
    'gado gado':          'vegetable salad peanut sauce',
    'lalapan':            'raw vegetables',
    'kangkung':           'water spinach',
    'bayam':              'spinach',
    'buncis':             'green beans',
    'wortel':             'carrot',
    'kacang panjang':     'long bean',
    'terong':             'eggplant',
    'kubis':              'cabbage',
    'tauge':              'bean sprouts',
    'jamur':              'mushroom',

    // Sambal & Saus
    'sambal':             'chili sauce',
    'kecap':              'sweet soy sauce',

    // Jajanan & Gorengan
    'pisang goreng':      'fried banana',
    'tempe mendoan':      'fried tempeh in batter',
    'bakwan':             'vegetable fritter',
    'risol':              'fried spring roll',
    'lumpia':             'spring roll',
    'martabak':           'stuffed pancake',
    'cireng':             'fried tapioca',
    'cilok':              'tapioca ball',
    'siomay':             'steamed fish dumpling',
    'batagor':            'fried fish dumpling',

    // Instan
    'indomie goreng':     'instant fried noodles',
    'indomie rebus':      'instant noodle soup',
    'indomie':            'instant noodles',
    'pop mie':            'instant cup noodles',
    'mie sedaap':         'instant noodles',

    // Buah
    'pisang':             'banana',
    'apel':               'apple',
    'jeruk':              'orange',
    'semangka':           'watermelon',
    'melon':              'melon',
    'mangga':             'mango',
    'pepaya':             'papaya',
    'nanas':              'pineapple',
    'anggur':             'grape',
    'stroberi':           'strawberry',
    'alpukat':            'avocado',
    'durian':             'durian',
    'rambutan':           'rambutan',

    // Minuman
    'es teh':             'iced tea',
    'teh manis':          'sweet tea',
    'kopi susu':          'coffee with milk',
    'kopi':               'coffee',
    'susu':               'milk',
    'jus jeruk':          'orange juice',
    'jus alpukat':        'avocado juice',
    'es jeruk':           'iced orange juice',

    // Makanan Barat / Fast food
    'burger':             'burger',
    'pizza':              'pizza',
    'sandwich':           'sandwich',
    'nugget ayam':        'chicken nuggets',
    'nugget':             'chicken nuggets',
    'hot dog':            'hot dog',
};

// ─── ALIAS MAP ────────────────────────────────────────────────
// Variasi ejaan / singkatan → nama kanonik Indonesia

const ALIASES = {
    'rice':        'nasi putih',
    'nasi':        'nasi putih',
    'chicken':     'ayam goreng',
    'ayam':        'ayam goreng',
    'beef':        'daging sapi',
    'sapi':        'daging sapi',
    'egg':         'telur rebus',
    'telur mata':  'telur goreng',
    'tempe':       'tempe goreng',
    'tahu':        'tahu goreng',
    'fish':        'ikan goreng',
    'ikan':        'ikan goreng',
    'shrimp':      'udang',
    'noodles':     'mie goreng',
    'mie':         'mie goreng',
    'tofu':        'tahu goreng',
    'banana':      'pisang',
    'apple':       'apel',
    'orange':      'jeruk',
};

// ─── CORE FUNCTIONS ───────────────────────────────────────────

/**
 * Normalize food name → canonical form + cache key + English translation
 *
 * @param {string} foodName - raw food name dari user/Gemini
 * @returns {{ normalized: string, english: string, cacheKey: string }}
 *
 * @example
 * normalizeFood('Nasi Goreng 1 Piring')
 * // → { normalized: 'nasi goreng', english: 'fried rice', cacheKey: 'nasi_goreng' }
 */
function normalizeFood(foodName) {
    if (!foodName || typeof foodName !== 'string') {
        return { normalized: '', english: '', cacheKey: '' };
    }

    // 1. Lowercase + trim
    let text = foodName.toLowerCase().trim();

    // 2. Buang angka (termasuk desimal) + karakter khusus
    text = text.replace(/\d+(\.\d+)?/g, ' ');
    text = text.replace(/[()[\]{}"']/g, ' ');

    // 3. Split → filter stopwords → rejoin
    const words = text
        .split(/[\s,+&/\-_]+/)
        .map(w => w.trim())
        .filter(w => w.length >= 2 && !STOPWORDS.has(w));

    // 4. Gabungkan kembali
    let normalized = words.join(' ').trim();

    // 5. Resolve alias kalau ada
    if (ALIASES[normalized]) {
        normalized = ALIASES[normalized];
    }

    // 6. Translate ke English untuk USDA/OFF lookup
    const english = ID_TO_EN[normalized] || translatePartial(normalized) || normalized;

    // 7. Build cache key — lowercase, underscore, no spaces
    const cacheKey = normalized
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .substring(0, 100); // max 100 chars

    return { normalized, english, cacheKey };
}

/**
 * Translate sebagian — coba cocokkan substring dari dictionary
 * Fallback kalau exact match gak ketemu
 *
 * @param {string} normalized
 * @returns {string|null}
 */
function translatePartial(normalized) {
    // Coba cari key yang mengandung normalized, atau normalized mengandung key
    for (const [id, en] of Object.entries(ID_TO_EN)) {
        if (normalized.includes(id) || id.includes(normalized)) {
            return en;
        }
    }
    return null;
}

/**
 * Extract quantity/portion info dari teks mentah user
 * Berguna buat pre-process sebelum Gemini identifikasi
 *
 * @param {string} rawText
 * @returns {{ food: string, qty: string|null }}
 *
 * @example
 * extractQuantity('nasi goreng 1 piring')
 * // → { food: 'nasi goreng', qty: '1 piring' }
 */
function extractQuantity(rawText) {
    // Pattern: [angka] [satuan]
    const qtyPattern = /(\d+(?:[.,]\d+)?)\s*(porsi|piring|mangkok|gelas|bungkus|potong|butir|lembar|buah|gram|gr|g\b|ml|kg|centong|sdm|sdt)/gi;
    const match = rawText.match(qtyPattern);
    const qty = match ? match[0] : null;
    const food = rawText.replace(qtyPattern, '').replace(/\s+/g, ' ').trim();
    return { food, qty };
}

/**
 * Build search queries dari normalized food name
 * Buat di-pass ke USDA / OFF biar coverage lebih luas
 *
 * @param {string} normalized
 * @param {string} english
 * @returns {string[]} ordered list of search queries (paling spesifik dulu)
 */
function buildSearchQueries(normalized, english) {
    const queries = new Set();

    // 1. English translation (paling akurat buat USDA)
    if (english && english !== normalized) queries.add(english);

    // 2. Normalized Indonesian
    queries.add(normalized);

    // 3. Kata pertama saja (broad search)
    const firstWord = english.split(' ')[0];
    if (firstWord.length > 2) queries.add(firstWord);

    return [...queries].filter(Boolean);
}

module.exports = {
    normalizeFood,
    extractQuantity,
    buildSearchQueries,
    ID_TO_EN,    // export buat testing / reference
};