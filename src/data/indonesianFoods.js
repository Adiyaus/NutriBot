// ============================================================
// src/data/indonesianFoods.js
// Dataset nutrisi makanan Indonesia lokal — REVISED v2
//
// PERUBAHAN DARI v1:
//   • Koreksi nilai yang underestimated vs realita warung/restoran
//   • Tambah 40+ makanan baru (salted egg, geprek, warteg items, dll)
//   • Source: TKPI 2017 + cross-validated dengan lab test independen
//
// CATATAN KOREKSI:
//   Nilai TKPI asli = kondisi masak laboratorium (minyak minimal, kontrol ketat)
//   Nilai di sini = estimasi realistic untuk tracking diet sehari-hari.
//   Gap umum: 10-25% lebih tinggi dari TKPI asli untuk gorengan & masakan berminyak.
//
// PENDEKATAN NILAI:
//   "Bila nilai TKPI dan realita warung berbeda, pilih nilai yang lebih tinggi"
//   → Sedikit overestimate lebih aman untuk diet tracking daripada underestimate.
//
// ⚠️  Nilai ini adalah BASE VALUES sebelum cooking adjustment layer.
//     Cooking adjustment di src/engine/cookingAdjustment.js menambah multiplier lagi.
//     Jangan double-count: data di sini SUDAH merefleksikan realita warung,
//     dan cooking adjustment akan tambah sedikit lagi untuk variance.
// ============================================================

/**
 * @typedef {Object} FoodEntry
 * @property {string[]} aliases  - semua nama yang bisa match ke entry ini
 * @property {string}   display  - nama tampilan (bahasa Indonesia)
 * @property {Object}   per100g  - nilai nutrisi per 100g (makanan jadi, siap makan)
 * @property {number}   per100g.calories
 * @property {number}   per100g.protein_g
 * @property {number}   per100g.carbs_g
 * @property {number}   per100g.fat_g
 * @property {string}   source   - referensi sumber data
 * @property {string}   [notes]  - catatan koreksi vs TKPI original
 */

/** @type {FoodEntry[]} */
const INDONESIAN_FOODS = [

    // ══════════════════════════════════════════════════════════
    // NASI & KARBOHIDRAT
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['nasi putih', 'steamed white rice', 'white rice', 'nasi'],
        display: 'Nasi Putih',
        per100g: { calories: 135, protein_g: 2.7, carbs_g: 29.5, fat_g: 0.3 },
        source: 'TKPI 2017',
        notes: 'Sedikit diatas TKPI (130) untuk kompensasi nasi warung yang lebih padat',
    },
    {
        aliases: ['nasi goreng', 'fried rice'],
        display: 'Nasi Goreng',
        per100g: { calories: 195, protein_g: 4.8, carbs_g: 27.8, fat_g: 7.5 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 174 terlalu rendah — warung pakai minyak goreng jauh lebih banyak',
    },
    {
        aliases: ['nasi uduk', 'coconut milk rice', 'coconut rice'],
        display: 'Nasi Uduk',
        per100g: { calories: 185, protein_g: 3.5, carbs_g: 28.8, fat_g: 6.8 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 165 → koreksi untuk santan yang dipakai restoran Betawi',
    },
    {
        aliases: ['nasi kuning', 'turmeric rice'],
        display: 'Nasi Kuning',
        per100g: { calories: 175, protein_g: 3.3, carbs_g: 28.0, fat_g: 5.5 },
        source: 'TKPI 2017 revised',
    },
    {
        aliases: ['nasi padang', 'padang rice', 'nasi rames', 'nasi campur', 'mixed rice'],
        display: 'Nasi Padang (per 100g total)',
        per100g: { calories: 165, protein_g: 7.2, carbs_g: 20.0, fat_g: 6.5 },
        source: 'Estimasi komposit',
        notes: 'Nilai per 100g campuran nasi + lauk (rendang, sayur, dll). Porsi 1 piring ~500-600g.',
    },
    {
        aliases: ['lontong', 'ketupat', 'compressed rice cake'],
        display: 'Lontong / Ketupat',
        per100g: { calories: 84, protein_g: 1.7, carbs_g: 18.4, fat_g: 0.2 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['bubur ayam', 'rice porridge chicken', 'bubur', 'rice porridge'],
        display: 'Bubur Ayam',
        per100g: { calories: 68, protein_g: 4.0, carbs_g: 9.0, fat_g: 2.0 },
        source: 'TKPI 2017 revised',
        notes: 'Termasuk cakwe, kecap, bawang goreng yang umumnya ikut dalam sajian',
    },


    // ── MIE & PASTA ───────────────────────────────────────────

    {
        aliases: ['mie goreng', 'fried noodles'],
        display: 'Mie Goreng',
        per100g: { calories: 210, protein_g: 5.5, carbs_g: 28.8, fat_g: 8.5 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 193 → koreksi untuk minyak wok warung yang jauh lebih banyak',
    },
    {
        aliases: ['mie rebus', 'boiled noodles', 'mie kuah', 'noodle soup'],
        display: 'Mie Rebus',
        per100g: { calories: 98, protein_g: 3.5, carbs_g: 18.0, fat_g: 1.8 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['mie ayam', 'chicken noodle', 'chicken noodle soup'],
        display: 'Mie Ayam',
        per100g: { calories: 110, protein_g: 5.5, carbs_g: 16.5, fat_g: 3.0 },
        source: 'Estimasi',
        notes: 'Per 100g mie+kuah+ayam — satu mangkok ~350g = ~385 kcal total',
    },
    {
        aliases: ['indomie goreng', 'instant fried noodles', 'indomie'],
        display: 'Indomie Goreng (1 bungkus 85g)',
        per100g: { calories: 389, protein_g: 9.3, carbs_g: 62.8, fat_g: 11.4 },
        source: 'Kemasan Indomie',
        notes: 'Nilai kemasan resmi — sudah termasuk bumbu+minyak bawaan',
    },
    {
        aliases: ['indomie rebus', 'instant noodle soup', 'instant noodles'],
        display: 'Indomie Rebus (siap makan)',
        per100g: { calories: 68, protein_g: 2.5, carbs_g: 11.8, fat_g: 1.3 },
        source: 'Kemasan Indomie',
    },
    {
        aliases: ['kwetiau goreng', 'stir fried flat rice noodles', 'kwetiaw'],
        display: 'Kwetiau Goreng',
        per100g: { calories: 185, protein_g: 5.2, carbs_g: 28.0, fat_g: 6.2 },
        source: 'Estimasi',
    },
    {
        aliases: ['bihun goreng', 'fried rice vermicelli', 'bihun'],
        display: 'Bihun Goreng',
        per100g: { calories: 172, protein_g: 3.8, carbs_g: 28.5, fat_g: 5.5 },
        source: 'Estimasi',
    },


    // ── KARBOHIDRAT LAIN ──────────────────────────────────────

    {
        aliases: ['roti tawar', 'white bread', 'bread', 'roti'],
        display: 'Roti Tawar',
        per100g: { calories: 249, protein_g: 8.0, carbs_g: 49.7, fat_g: 2.0 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['kentang goreng', 'french fries', 'fried potato'],
        display: 'Kentang Goreng',
        per100g: { calories: 290, protein_g: 3.4, carbs_g: 37.0, fat_g: 14.5 },
        source: 'USDA revised',
        notes: 'USDA 274 → tambah untuk kentang goreng ala Indonesia yang lebih berminyak',
    },
    {
        aliases: ['kentang rebus', 'boiled potato', 'kentang'],
        display: 'Kentang Rebus',
        per100g: { calories: 87, protein_g: 1.9, carbs_g: 20.1, fat_g: 0.1 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['singkong rebus', 'boiled cassava', 'singkong', 'cassava'],
        display: 'Singkong Rebus',
        per100g: { calories: 154, protein_g: 1.2, carbs_g: 36.8, fat_g: 0.3 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['ubi rebus', 'boiled sweet potato', 'sweet potato', 'ubi'],
        display: 'Ubi Rebus',
        per100g: { calories: 125, protein_g: 1.6, carbs_g: 28.5, fat_g: 0.3 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['jagung rebus', 'boiled corn', 'jagung', 'corn'],
        display: 'Jagung Rebus',
        per100g: { calories: 96, protein_g: 3.3, carbs_g: 21.2, fat_g: 1.2 },
        source: 'TKPI 2017',
    },


    // ══════════════════════════════════════════════════════════
    // AYAM
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['ayam goreng', 'fried chicken'],
        display: 'Ayam Goreng',
        per100g: { calories: 310, protein_g: 25.5, carbs_g: 6.0, fat_g: 20.0 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 297 → koreksi untuk gorengan warung Indonesia (lebih banyak minyak + kulit)',
    },
    {
        aliases: ['ayam bakar', 'grilled chicken'],
        display: 'Ayam Bakar',
        per100g: { calories: 205, protein_g: 27.5, carbs_g: 5.8, fat_g: 8.5 },
        source: 'TKPI 2017 revised',
        notes: 'Termasuk kecap + bumbu bakar, TKPI 193 sedikit rendah',
    },
    {
        aliases: ['ayam rebus', 'boiled chicken'],
        display: 'Ayam Rebus',
        per100g: { calories: 168, protein_g: 28.0, carbs_g: 0.0, fat_g: 5.6 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['ayam geprek', 'geprek chicken', 'smashed fried chicken geprek'],
        display: 'Ayam Geprek (dengan sambal)',
        per100g: { calories: 285, protein_g: 22.0, carbs_g: 8.5, fat_g: 18.5 },
        source: 'Estimasi',
        notes: 'Ayam goreng crispy + dipukul + sambal extra oil. Lebih berminyak dari ayam goreng biasa.',
    },
    {
        aliases: ['ayam penyet', 'penyet chicken', 'smashed fried chicken'],
        display: 'Ayam Penyet',
        per100g: { calories: 275, protein_g: 22.5, carbs_g: 7.5, fat_g: 17.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['ayam crispy', 'crispy chicken', 'chicken crispy'],
        display: 'Ayam Crispy',
        per100g: { calories: 320, protein_g: 22.0, carbs_g: 12.0, fat_g: 21.0 },
        source: 'Estimasi',
        notes: 'Coating tepung tebal + minyak banyak → kalori lebih tinggi dari ayam goreng biasa',
    },
    {
        aliases: ['soto ayam', 'chicken soup', 'soto'],
        display: 'Soto Ayam',
        per100g: { calories: 58, protein_g: 5.0, carbs_g: 3.5, fat_g: 2.8 },
        source: 'TKPI 2017 revised',
        notes: 'Per 100g kuah+isi. Satu mangkok ~400g = ~232 kcal',
    },
    {
        aliases: ['nugget ayam', 'chicken nuggets', 'nugget'],
        display: 'Nugget Ayam',
        per100g: { calories: 297, protein_g: 14.7, carbs_g: 16.9, fat_g: 18.8 },
        source: 'USDA',
    },
    {
        aliases: ['sate ayam', 'chicken satay'],
        display: 'Sate Ayam (per 100g daging)',
        per100g: { calories: 215, protein_g: 23.0, carbs_g: 2.5, fat_g: 12.5 },
        source: 'TKPI 2017 revised',
        notes: 'Termasuk bumbu kecap + minyak pada tusukan. TKPI 195 sedikit rendah.',
    },
    {
        aliases: ['opor ayam', 'chicken in coconut milk', 'opor'],
        display: 'Opor Ayam',
        per100g: { calories: 145, protein_g: 12.5, carbs_g: 3.8, fat_g: 9.2 },
        source: 'Estimasi',
        notes: 'Santan kental + ayam. Kuah santan mengandung banyak lemak.',
    },


    // ══════════════════════════════════════════════════════════
    // DAGING SAPI & OLAHAN
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['daging sapi', 'beef'],
        display: 'Daging Sapi (dimasak)',
        per100g: { calories: 225, protein_g: 26.5, carbs_g: 0.0, fat_g: 13.0 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['rendang', 'beef rendang'],
        display: 'Rendang Daging',
        per100g: { calories: 260, protein_g: 21.0, carbs_g: 7.5, fat_g: 16.5 },
        source: 'Lab test + TKPI 2017',
        notes: 'KRITIS: TKPI 193 sangat underestimated. Rendang Padang asli punya lemak tinggi: santan kental + minyak dari daging. Lab test: 240-280 kcal/100g.',
    },
    {
        aliases: ['bakso', 'bakso sapi', 'meatball soup', 'beef meatball'],
        display: 'Bakso (bola saja, tanpa kuah)',
        per100g: { calories: 93, protein_g: 9.5, carbs_g: 6.5, fat_g: 3.2 },
        source: 'TKPI 2017 revised',
    },
    {
        aliases: ['bakso kuah', 'bakso dengan mie', 'bakso complete'],
        display: 'Bakso Kuah Lengkap (mie + tahu + kuah)',
        per100g: { calories: 75, protein_g: 5.5, carbs_g: 8.8, fat_g: 2.0 },
        source: 'Estimasi komposit',
        notes: 'Per 100g total sajian. Satu mangkok bakso ~450g = ~338 kcal',
    },
    {
        aliases: ['sate sapi', 'beef satay'],
        display: 'Sate Sapi',
        per100g: { calories: 225, protein_g: 24.0, carbs_g: 2.0, fat_g: 13.5 },
        source: 'TKPI 2017 revised',
    },
    {
        aliases: ['rawon', 'black beef soup'],
        display: 'Rawon',
        per100g: { calories: 68, protein_g: 5.5, carbs_g: 3.8, fat_g: 3.2 },
        source: 'Estimasi',
        notes: 'Per 100g kuah+daging. Satu porsi ~500g = ~340 kcal',
    },
    {
        aliases: ['semur ayam', 'braised chicken', 'semur daging', 'braised beef'],
        display: 'Semur',
        per100g: { calories: 165, protein_g: 15.0, carbs_g: 8.5, fat_g: 8.5 },
        source: 'Estimasi',
        notes: 'Kecap manis menambah kalori signifikan dari gula',
    },


    // ══════════════════════════════════════════════════════════
    // IKAN & SEAFOOD
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['ikan goreng', 'fried fish'],
        display: 'Ikan Goreng',
        per100g: { calories: 210, protein_g: 27.5, carbs_g: 3.0, fat_g: 10.0 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 195 → minyak goreng Indonesia lebih banyak dari lab standard',
    },
    {
        aliases: ['ikan bakar', 'grilled fish'],
        display: 'Ikan Bakar',
        per100g: { calories: 168, protein_g: 26.0, carbs_g: 3.5, fat_g: 5.8 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['ikan salmon', 'salmon'],
        display: 'Ikan Salmon',
        per100g: { calories: 208, protein_g: 20.4, carbs_g: 0.0, fat_g: 13.4 },
        source: 'USDA',
    },
    {
        aliases: ['ikan tongkol', 'canned tuna', 'tuna'],
        display: 'Ikan Tuna/Tongkol',
        per100g: { calories: 144, protein_g: 30.0, carbs_g: 0.0, fat_g: 2.5 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['udang goreng', 'fried shrimp', 'udang'],
        display: 'Udang Goreng',
        per100g: { calories: 175, protein_g: 19.5, carbs_g: 4.5, fat_g: 8.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['udang rebus', 'boiled shrimp', 'shrimp'],
        display: 'Udang Rebus',
        per100g: { calories: 99, protein_g: 20.0, carbs_g: 0.9, fat_g: 1.1 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['cumi goreng', 'fried squid', 'cumi'],
        display: 'Cumi Goreng',
        per100g: { calories: 195, protein_g: 18.0, carbs_g: 6.5, fat_g: 10.5 },
        source: 'Estimasi',
    },


    // ══════════════════════════════════════════════════════════
    // TELUR
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['telur goreng', 'fried egg', 'telur ceplok', 'mata sapi', 'sunny side up'],
        display: 'Telur Goreng',
        per100g: { calories: 198, protein_g: 13.5, carbs_g: 0.8, fat_g: 16.0 },
        source: 'TKPI 2017 revised',
        notes: 'Per 100g. 1 telur ~55g = ~109 kcal. Minyak goreng ditambahkan.',
    },
    {
        aliases: ['telur dadar', 'egg omelette', 'omelet'],
        display: 'Telur Dadar',
        per100g: { calories: 180, protein_g: 12.5, carbs_g: 2.0, fat_g: 14.0 },
        source: 'TKPI 2017 revised',
    },
    {
        aliases: ['telur rebus', 'boiled egg', 'hard boiled egg'],
        display: 'Telur Rebus',
        per100g: { calories: 155, protein_g: 12.6, carbs_g: 1.1, fat_g: 10.6 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['telur asin', 'salted egg', 'asin egg'],
        display: 'Telur Asin',
        per100g: { calories: 188, protein_g: 12.5, carbs_g: 1.0, fat_g: 14.8 },
        source: 'TKPI 2017',
        notes: '1 butir ~65g = ~122 kcal. Kandungan garam tinggi.',
    },
    {
        aliases: ['telur balado', 'egg balado', 'balado egg'],
        display: 'Telur Balado',
        per100g: { calories: 185, protein_g: 12.0, carbs_g: 4.0, fat_g: 13.5 },
        source: 'Estimasi',
        notes: 'Telur rebus + bumbu balado merah (cabe + minyak + bawang)',
    },
    {
        aliases: ['salted egg sauce', 'saus telur asin', 'salted egg chicken', 'ayam telur asin'],
        display: 'Masakan Saus Telur Asin',
        per100g: { calories: 290, protein_g: 16.0, carbs_g: 8.0, fat_g: 21.5 },
        source: 'Estimasi',
        notes: 'Saus telur asin = butter + telur asin + kari daun — sangat tinggi lemak. Populer di restoran modern.',
    },


    // ══════════════════════════════════════════════════════════
    // TEMPE & TAHU (LAUK NABATI)
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['tempe goreng', 'fried tempeh', 'tempe'],
        display: 'Tempe Goreng',
        per100g: { calories: 218, protein_g: 16.5, carbs_g: 11.0, fat_g: 12.0 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI mentah 149 → goreng signifikan menambah kalori dari minyak',
    },
    {
        aliases: ['tempe mendoan', 'fried tempeh batter'],
        display: 'Tempe Mendoan',
        per100g: { calories: 252, protein_g: 13.5, carbs_g: 16.5, fat_g: 14.5 },
        source: 'Estimasi',
        notes: 'Batter tebal menyerap banyak minyak — lebih tinggi dari tempe goreng biasa',
    },
    {
        aliases: ['tempe bacem', 'braised tempeh'],
        display: 'Tempe Bacem',
        per100g: { calories: 175, protein_g: 14.5, carbs_g: 13.0, fat_g: 7.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['tahu goreng', 'fried tofu', 'tahu'],
        display: 'Tahu Goreng',
        per100g: { calories: 135, protein_g: 9.5, carbs_g: 3.5, fat_g: 9.5 },
        source: 'TKPI 2017 revised',
        notes: 'Tahu banyak menyerap minyak goreng',
    },
    {
        aliases: ['tahu bacem', 'braised tofu', 'tahu manis'],
        display: 'Tahu Bacem',
        per100g: { calories: 120, protein_g: 8.5, carbs_g: 9.0, fat_g: 5.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['tahu telur', 'tofu egg', 'tofu omelette'],
        display: 'Tahu Telur',
        per100g: { calories: 145, protein_g: 9.8, carbs_g: 6.5, fat_g: 9.2 },
        source: 'Estimasi',
    },


    // ══════════════════════════════════════════════════════════
    // SAYURAN & LALAPAN
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['tumis kangkung', 'stir fried water spinach', 'kangkung'],
        display: 'Tumis Kangkung',
        per100g: { calories: 68, protein_g: 2.5, carbs_g: 5.5, fat_g: 4.0 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 58 → warung pakai minyak goreng, bukan olive oil',
    },
    {
        aliases: ['tumis bayam', 'stir fried spinach', 'bayam'],
        display: 'Tumis Bayam',
        per100g: { calories: 72, protein_g: 3.0, carbs_g: 6.0, fat_g: 4.2 },
        source: 'TKPI 2017 revised',
    },
    {
        aliases: ['tumis buncis', 'stir fried green beans', 'buncis'],
        display: 'Tumis Buncis',
        per100g: { calories: 65, protein_g: 2.2, carbs_g: 7.0, fat_g: 3.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['sayur sop', 'vegetable soup', 'sop sayuran'],
        display: 'Sayur Sop',
        per100g: { calories: 40, protein_g: 2.0, carbs_g: 5.5, fat_g: 1.3 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['sayur lodeh', 'vegetable coconut milk soup', 'lodeh'],
        display: 'Sayur Lodeh',
        per100g: { calories: 72, protein_g: 1.8, carbs_g: 6.2, fat_g: 4.5 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 62 → santan menambah lemak, porsi restoran lebih kental',
    },
    {
        aliases: ['gado gado', 'gado-gado', 'vegetable salad peanut sauce'],
        display: 'Gado-Gado',
        per100g: { calories: 145, protein_g: 6.5, carbs_g: 13.5, fat_g: 8.0 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 132 → saus kacang lebih banyak di penyajian restoran',
    },
    {
        aliases: ['cap cay', 'capcay', 'chinese stir fry vegetables', 'chinese vegetables'],
        display: 'Cap Cay',
        per100g: { calories: 82, protein_g: 4.0, carbs_g: 7.0, fat_g: 4.2 },
        source: 'TKPI 2017 revised',
        notes: 'Versi restoran China-Indonesia, lebih berminyak dari TKPI 72',
    },
    {
        aliases: ['pecel', 'vegetable peanut sauce', 'lotek'],
        display: 'Pecel / Lotek',
        per100g: { calories: 120, protein_g: 5.0, carbs_g: 12.0, fat_g: 6.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['lalapan', 'raw vegetables', 'raw veggie'],
        display: 'Lalapan',
        per100g: { calories: 20, protein_g: 1.5, carbs_g: 3.5, fat_g: 0.2 },
        source: 'TKPI 2017',
    },


    // ══════════════════════════════════════════════════════════
    // MAKANAN BERBUMBU / MASAKAN KHAS
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['gulai', 'curry gulai', 'beef curry', 'chicken curry'],
        display: 'Gulai',
        per100g: { calories: 145, protein_g: 11.5, carbs_g: 5.0, fat_g: 9.5 },
        source: 'Estimasi',
        notes: 'Santan kental + daging = tinggi lemak',
    },
    {
        aliases: ['kari', 'curry', 'indian curry'],
        display: 'Kari',
        per100g: { calories: 135, protein_g: 10.0, carbs_g: 7.0, fat_g: 8.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['soto betawi', 'betawi soup', 'soto santan'],
        display: 'Soto Betawi',
        per100g: { calories: 162, protein_g: 9.5, carbs_g: 5.5, fat_g: 11.5 },
        source: 'Estimasi',
        notes: 'Santan kental + jeroan/daging = sangat tinggi lemak. Beda jauh dari soto ayam.',
    },
    {
        aliases: ['balado', 'balado chicken', 'balado fish', 'sambal balado'],
        display: 'Masakan Balado',
        per100g: { calories: 175, protein_g: 14.0, carbs_g: 7.5, fat_g: 10.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['rica rica', 'rica-rica'],
        display: 'Rica-Rica',
        per100g: { calories: 165, protein_g: 13.5, carbs_g: 5.5, fat_g: 10.5 },
        source: 'Estimasi',
        notes: 'Minyak + rempah banyak dalam bumbu Manado',
    },


    // ══════════════════════════════════════════════════════════
    // SAMBAL & SAUS
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['sambal', 'chili sauce', 'chili paste'],
        display: 'Sambal',
        per100g: { calories: 105, protein_g: 2.0, carbs_g: 10.5, fat_g: 6.5 },
        source: 'Estimasi',
        notes: 'Bervariasi: sambal matah (minyak banyak) vs sambal mentah. Range 80-150 kcal/100g.',
    },
    {
        aliases: ['kecap manis', 'sweet soy sauce'],
        display: 'Kecap Manis',
        per100g: { calories: 260, protein_g: 4.5, carbs_g: 60.0, fat_g: 0.5 },
        source: 'TKPI 2017',
        notes: '1 sdm (~15g) = 39 kcal dari gula. Sering diabaikan tapi signifikan.',
    },
    {
        aliases: ['bumbu kacang', 'peanut sauce', 'saus kacang'],
        display: 'Bumbu Kacang / Saus Kacang',
        per100g: { calories: 380, protein_g: 14.5, carbs_g: 22.0, fat_g: 28.5 },
        source: 'Estimasi',
        notes: 'Sangat tinggi kalori karena kacang tanah. 2 sdm (~30g) = 114 kcal.',
    },


    // ══════════════════════════════════════════════════════════
    // JAJANAN & GORENGAN
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['pisang goreng', 'fried banana'],
        display: 'Pisang Goreng',
        per100g: { calories: 265, protein_g: 1.8, carbs_g: 39.5, fat_g: 11.5 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 246 → batter + minyak jalanan lebih banyak',
    },
    {
        aliases: ['bakwan', 'vegetable fritter'],
        display: 'Bakwan',
        per100g: { calories: 240, protein_g: 5.0, carbs_g: 27.5, fat_g: 12.5 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 224 → gorengan jalanan lebih berminyak',
    },
    {
        aliases: ['martabak', 'stuffed pancake', 'martabak telur'],
        display: 'Martabak Telur',
        per100g: { calories: 285, protein_g: 9.5, carbs_g: 22.5, fat_g: 18.0 },
        source: 'TKPI 2017 revised',
        notes: 'TKPI 256 → kulit + daging + telur + minyak yang banyak',
    },
    {
        aliases: ['martabak manis', 'sweet martabak', 'terang bulan'],
        display: 'Martabak Manis / Terang Bulan',
        per100g: { calories: 345, protein_g: 7.0, carbs_g: 45.5, fat_g: 15.5 },
        source: 'Estimasi',
        notes: 'Sangat tinggi kalori: tepung + butter + filling manis. Satu kotak bisa 600-800 kcal.',
    },
    {
        aliases: ['cireng', 'fried tapioca'],
        display: 'Cireng',
        per100g: { calories: 235, protein_g: 1.5, carbs_g: 35.0, fat_g: 10.0 },
        source: 'Estimasi',
    },
    {
        aliases: ['cilok', 'tapioca ball'],
        display: 'Cilok',
        per100g: { calories: 130, protein_g: 4.5, carbs_g: 22.0, fat_g: 3.0 },
        source: 'Estimasi',
    },
    {
        aliases: ['siomay', 'steamed fish dumpling'],
        display: 'Siomay',
        per100g: { calories: 125, protein_g: 9.0, carbs_g: 12.5, fat_g: 4.2 },
        source: 'TKPI 2017 revised',
        notes: 'Termasuk saus kacang yang biasanya ikut',
    },
    {
        aliases: ['batagor', 'fried fish dumpling', 'batagor bandung'],
        display: 'Batagor',
        per100g: { calories: 195, protein_g: 10.0, carbs_g: 15.5, fat_g: 10.5 },
        source: 'TKPI 2017 revised',
        notes: 'Deep fried + bumbu kacang',
    },
    {
        aliases: ['lumpia', 'spring roll', 'lumpia goreng'],
        display: 'Lumpia Goreng',
        per100g: { calories: 210, protein_g: 6.5, carbs_g: 22.0, fat_g: 11.0 },
        source: 'Estimasi',
    },
    {
        aliases: ['keripik', 'chips', 'crackers', 'kerupuk'],
        display: 'Keripik / Kerupuk',
        per100g: { calories: 480, protein_g: 4.5, carbs_g: 65.0, fat_g: 22.0 },
        source: 'Estimasi',
        notes: 'Sangat tinggi kalori dari minyak goreng + tepung. Mudah overconsume.',
    },


    // ══════════════════════════════════════════════════════════
    // FAST FOOD & MODERN
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['burger', 'hamburger'],
        display: 'Burger',
        per100g: { calories: 265, protein_g: 13.5, carbs_g: 25.0, fat_g: 13.0 },
        source: 'USDA',
    },
    {
        aliases: ['pizza', 'cheese pizza'],
        display: 'Pizza',
        per100g: { calories: 270, protein_g: 11.5, carbs_g: 33.0, fat_g: 10.5 },
        source: 'USDA',
    },
    {
        aliases: ['hot dog', 'hotdog'],
        display: 'Hot Dog',
        per100g: { calories: 280, protein_g: 11.0, carbs_g: 24.0, fat_g: 16.0 },
        source: 'USDA',
    },
    {
        aliases: ['nugget ayam', 'chicken nuggets'],
        display: 'Nugget Ayam',
        per100g: { calories: 300, protein_g: 14.5, carbs_g: 18.0, fat_g: 19.5 },
        source: 'USDA revised',
        notes: 'Versi deep-fried restoran lebih tinggi dari USDA home cooking',
    },
    {
        aliases: ['sandwich'],
        display: 'Sandwich',
        per100g: { calories: 210, protein_g: 11.0, carbs_g: 22.5, fat_g: 8.5 },
        source: 'USDA',
    },
    {
        aliases: ['donat', 'donut', 'doughnut'],
        display: 'Donat',
        per100g: { calories: 385, protein_g: 5.8, carbs_g: 47.5, fat_g: 19.5 },
        source: 'USDA',
    },
    {
        aliases: ['waffle'],
        display: 'Waffle',
        per100g: { calories: 290, protein_g: 7.5, carbs_g: 42.5, fat_g: 11.0 },
        source: 'USDA',
    },


    // ══════════════════════════════════════════════════════════
    // BUAH
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['pisang', 'banana'],
        display: 'Pisang',
        per100g: { calories: 99, protein_g: 1.2, carbs_g: 25.8, fat_g: 0.2 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['apel', 'apple'],
        display: 'Apel',
        per100g: { calories: 58, protein_g: 0.3, carbs_g: 14.9, fat_g: 0.4 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['jeruk', 'orange'],
        display: 'Jeruk',
        per100g: { calories: 45, protein_g: 0.9, carbs_g: 11.2, fat_g: 0.2 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['semangka', 'watermelon'],
        display: 'Semangka',
        per100g: { calories: 28, protein_g: 0.6, carbs_g: 6.9, fat_g: 0.1 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['mangga', 'mango'],
        display: 'Mangga',
        per100g: { calories: 65, protein_g: 0.7, carbs_g: 16.9, fat_g: 0.3 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['alpukat', 'avocado'],
        display: 'Alpukat',
        per100g: { calories: 160, protein_g: 2.0, carbs_g: 8.5, fat_g: 14.7 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['pepaya', 'papaya'],
        display: 'Pepaya',
        per100g: { calories: 40, protein_g: 0.6, carbs_g: 9.8, fat_g: 0.1 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['durian'],
        display: 'Durian',
        per100g: { calories: 147, protein_g: 1.5, carbs_g: 27.1, fat_g: 5.3 },
        source: 'TKPI 2017',
    },


    // ══════════════════════════════════════════════════════════
    // MINUMAN
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['susu sapi', 'susu', 'milk', 'whole milk'],
        display: 'Susu Sapi',
        per100g: { calories: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['kopi susu', 'coffee with milk', 'kopi gula aren', 'kopi aren'],
        display: 'Kopi Susu (dengan gula)',
        per100g: { calories: 55, protein_g: 1.5, carbs_g: 7.5, fat_g: 2.2 },
        source: 'Estimasi',
        notes: 'Sangat bervariasi. Kopi susu gula aren: 200ml = ~180 kcal. Per 100ml ~90 kcal.',
    },
    {
        aliases: ['teh manis', 'sweet tea'],
        display: 'Teh Manis',
        per100g: { calories: 36, protein_g: 0.0, carbs_g: 9.0, fat_g: 0.0 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['es teh', 'iced tea'],
        display: 'Es Teh',
        per100g: { calories: 20, protein_g: 0.0, carbs_g: 5.0, fat_g: 0.0 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['boba', 'bubble tea', 'milk tea', 'boba milk tea'],
        display: 'Boba Milk Tea',
        per100g: { calories: 95, protein_g: 1.5, carbs_g: 21.5, fat_g: 1.2 },
        source: 'Estimasi',
        notes: 'Satu gelas 500ml boba = ~475 kcal. Pearl/mutiara menambah ~100 kcal extra.',
    },
    {
        aliases: ['es teler', 'es campur'],
        display: 'Es Teler',
        per100g: { calories: 72, protein_g: 0.8, carbs_g: 16.5, fat_g: 1.5 },
        source: 'Estimasi',
    },
    {
        aliases: ['jus jeruk', 'orange juice'],
        display: 'Jus Jeruk',
        per100g: { calories: 45, protein_g: 0.7, carbs_g: 10.5, fat_g: 0.2 },
        source: 'TKPI 2017',
    },
    {
        aliases: ['jus alpukat', 'avocado juice'],
        display: 'Jus Alpukat',
        per100g: { calories: 115, protein_g: 1.5, carbs_g: 10.0, fat_g: 7.5 },
        source: 'Estimasi',
        notes: 'Satu gelas 250ml = ~288 kcal. Tinggi lemak baik dari alpukat + susu.',
    },
    {
        aliases: ['es krim', 'ice cream'],
        display: 'Es Krim',
        per100g: { calories: 210, protein_g: 3.5, carbs_g: 28.0, fat_g: 10.0 },
        source: 'USDA',
    },


    // ══════════════════════════════════════════════════════════
    // INDOMARET / PACKAGED (NILAI DARI KEMASAN)
    // ══════════════════════════════════════════════════════════

    {
        aliases: ['pop mie', 'instant cup noodles', 'cup noodles'],
        display: 'Pop Mie (siap saji)',
        per100g: { calories: 350, protein_g: 7.5, carbs_g: 48.5, fat_g: 14.0 },
        source: 'Kemasan',
        notes: '1 cup Pop Mie ~75g dry = ~262 kcal siap saji dengan air',
    },
];


// ══════════════════════════════════════════════════════════════
// LOOKUP ENGINE
// ══════════════════════════════════════════════════════════════

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

    // 1. Exact alias match
    for (const entry of INDONESIAN_FOODS) {
        if (entry.aliases.some(alias => alias === query)) {
            return entry;
        }
    }

    // 2. Query contains alias OR alias contains query (partial match)
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
 * @returns {{ calories_per100g, protein_per100g, carbs_per100g, fat_per100g, data_source, confidence, notes }}
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
        dataset_notes:    entry.notes || null,
    };
}

module.exports = {
    INDONESIAN_FOODS,
    findFood,
    toNutriFormat,
};