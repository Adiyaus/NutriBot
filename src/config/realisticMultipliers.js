// ============================================================
// src/config/realisticMultipliers.js
// Central config untuk semua multiplier kalori realistis
//
// MENGAPA FILE INI ADA:
//   USDA & TKPI adalah nilai "lab" — diukur dalam kondisi ideal,
//   minimal minyak, porsi standar. Kenyataan di warung/restoran Indonesia:
//     • Oil dipakai jauh lebih banyak dari standar resep
//     • Porsi warung lebih besar dari "serving size" database
//     • Fast food punya sauce/toping tersembunyi
//     • Gorengan jalanan punya coating + minyak lebih banyak
//
// GAP UMUM: TKPI/USDA vs realita = 15-40% undercounting
//
// CARA PAKAI:
//   const M = require('../config/realisticMultipliers');
//   const mid = M.cooking.deep_fried_battered.mid;   // 1.35
//   Tuning: langsung edit nilai di sini — tidak perlu ubah logika engine
//
// FORMAT MULTIPLIER:
//   { min, mid, max }
//   min = conservative estimate (mungkin dimasak dengan minyak lebih sedikit)
//   mid = most likely estimate (rata-rata warung/restoran normal)
//   max = upper estimate (banyak minyak, porsi besar, restoran premium)
// ============================================================

module.exports = {

    // ─── 1. COOKING METHOD MULTIPLIERS ─────────────────────────
    // Diterapkan ke base calories_per100g dari database
    // Alasan: nilai database = kondisi masak minimal/ideal
    // Realita masak Indonesia = minyak lebih banyak, sering deep fry panas tinggi
    //
    // Referensi oil absorption (% dari berat bahan):
    //   Deep fry naked:   8-12% berat jadi minyak terserap
    //   Deep fry battered:14-22% berat jadi minyak terserap
    //   Pan fry:          4-8%
    //   Stir fry:         2-5%
    //   Minyak = 9 kcal/g → absorpsi ini signifikan banget

    cooking: {
        // Deep frying tanpa batter (ayam goreng biasa, tempe goreng)
        deep_fried_naked: {
            min: 1.15,   // sedikit minyak, suhu tinggi (cepat matang, absorpsi rendah)
            mid: 1.28,   // rata-rata warung/restoran
            max: 1.45,   // minyak banyak, digoreng lama
            fat_multiplier: 1.50,   // lemak lebih naik drastis dari kalori total
        },

        // Deep frying dengan batter tebal (bakwan, cireng, pisang goreng, mendoan)
        deep_fried_battered: {
            min: 1.25,   // batter tipis, minyak cukup
            mid: 1.38,   // batter standar + minyak warung
            max: 1.55,   // batter tebal, minyak banyak (gorengan pinggir jalan)
            fat_multiplier: 1.65,
        },

        // Deep frying dengan breading/panir (nugget, katsu, crispy chicken)
        deep_fried_breaded: {
            min: 1.20,
            mid: 1.32,
            max: 1.48,
            fat_multiplier: 1.55,
        },

        // Pan fried / tumis dengan minyak sedang
        pan_fried: {
            min: 1.08,
            mid: 1.16,
            max: 1.25,
            fat_multiplier: 1.25,
        },

        // Stir fry ringan (tumis sayur, capcay)
        stir_fry_light: {
            min: 1.05,
            mid: 1.10,
            max: 1.18,
            fat_multiplier: 1.20,
        },

        // Stir fry berat (nasi goreng, mie goreng warung — minyak wok banyak)
        stir_fry_heavy: {
            min: 1.12,
            mid: 1.22,
            max: 1.35,
            fat_multiplier: 1.40,
        },

        // Masakan santan / coconut milk (opor, gulai, soto betawi, rendang)
        // Santan = ~200 kcal/100ml — ini sering diremehkan database
        coconut_milk: {
            min: 1.18,
            mid: 1.30,
            max: 1.48,
            fat_multiplier: 1.55,
        },

        // Heavy sauce (semur, kari, rendang kering, balado)
        heavy_sauce: {
            min: 1.10,
            mid: 1.20,
            max: 1.32,
            fat_multiplier: 1.30,
        },

        // Grilled with marinade (ayam bakar, sate — kecap + minyak)
        grilled_marinade: {
            min: 1.05,
            mid: 1.12,
            max: 1.20,
            fat_multiplier: 1.15,
        },

        // Plain boiled / steamed (sayur rebus, ayam rebus, telur rebus)
        plain: {
            min: 1.00,
            mid: 1.00,
            max: 1.05,
            fat_multiplier: 1.00,
        },

        // Smashed / geprek — fried dulu terus dipukul → sauce + extra oil
        geprek_penyet: {
            min: 1.20,
            mid: 1.35,
            max: 1.50,
            fat_multiplier: 1.60,
        },
    },


    // ─── 2. PORTION SCALING BIASES ─────────────────────────────
    // Diterapkan ke portion_g yang diestimasi Gemini
    // Alasan: Gemini cenderung estimasi "serving size ideal" bukan "warung riil"
    //
    // Contoh konkrit:
    //   Gemini estimates nasi goreng photo = 250g
    //   Warung nasi goreng biasanya 350-450g (nasi 250g + telur + sayur + minyak)
    //   → scaling 1.30 → 325g → lebih realistis

    portion: {
        // Warung / warteg — generous, selalu lebih dari label
        warung_warteg: {
            min: 1.15,
            mid: 1.28,
            max: 1.45,
        },

        // Restoran Indonesia (Padang, sunda, prasmanan)
        restaurant_indonesia: {
            min: 1.10,
            mid: 1.22,
            max: 1.35,
        },

        // Fast food chain Indonesia (McD, KFC, Burger King, J.CO)
        fast_food_chain: {
            min: 1.08,
            mid: 1.18,
            max: 1.28,
        },

        // Masakan rumah / home cooked — paling dekat dengan label
        home_cooked: {
            min: 0.95,
            mid: 1.00,
            max: 1.10,
        },

        // Jajanan pasar / gorengan pinggir jalan
        street_food: {
            min: 1.05,
            mid: 1.15,
            max: 1.28,
        },

        // Nasi khusus di warung — TKPI "1 piring = 200g" tapi warung = 280-350g
        rice_warung: {
            min: 1.20,
            mid: 1.35,
            max: 1.55,
        },
    },


    // ─── 3. INVISIBLE CALORIE COMPONENTS ───────────────────────
    // Kalori dari bahan yang tidak terdeteksi Gemini sebagai item terpisah
    // tapi selalu ada di piring warung/restoran

    invisible: {
        // Sambal: 1 sendok makan ~15g, 1 porsi 1-2 sdm
        sambal_per_sdm_kcal:    28,   // ~28 kcal per sdm (cabe + minyak + gula)
        sambal_default_sdm:     1.5,  // default: asumsi 1.5 sdm per piring

        // Kecap manis: 1 sdm = ~60 kcal (gula tinggi)
        kecap_per_sdm_kcal:     60,
        kecap_default_sdm:      1.0,

        // Minyak residu wajan tidak terhitung di nilai tumis
        stir_fry_extra_oil_per100g: 18,   // 18 kcal per 100g makanan

        // Sauce visible (terlihat di foto tapi tidak di-identify)
        sauce_visible_kcal:     90,

        // Butter/margarin untuk roti (sering gak ke-identify)
        butter_per_slice_kcal:  55,

        // Nasi warung bonus (porsi sering lebih besar dari yang kelihatan)
        // → sudah ditangani di portion.rice_warung
    },


    // ─── 4. DATASET BASE CORRECTION ────────────────────────────
    // Koreksi terhadap nilai database sebelum cooking method diterapkan
    // Alasan: nilai TKPI/USDA = kondisi masak minimal, bukan rata-rata restoran
    //
    // INI BEDANYA DARI geminicaloriebias.js:
    //   geminicaloriebias.js → hanya berlaku untuk gemini_estimate source
    //   dataset_correction   → berlaku untuk SEMUA sumber (termasuk TKPI, USDA)

    dataset_correction: {
        // TKPI 2017: nilai diambil dari laboratorium FSANZ/lab gizi
        // Restoran Indonesia memasak dengan 20-40% lebih banyak lemak
        indonesian_dataset: {
            fried_items:  1.18,   // ayam goreng, tempe goreng, dll
            sauteed:      1.12,   // tumis
            coconut_milk: 1.22,   // opor, gulai, soto betawi
            plain:        1.02,   // rebus, kukus → hampir sama
            fast_food:    1.15,   // nugget, kentang goreng (fast food vs USDA standard)
        },

        // USDA: nilai untuk American cooking, bukan Indonesian cooking style
        usda: {
            fried_items:  1.20,   // deep fry Indonesia lebih banyak minyak dari US
            sauteed:      1.15,
            plain:        1.00,
            fast_food:    1.08,   // fast food US vs Indonesia mirip
        },

        // OpenFoodFacts: produk kemasan — umumnya akurat, koreksi minimal
        openfoodfacts: {
            packaged:     1.00,   // nilai kemasan umumnya akurat
            restaurant:   1.12,   // kalau bukan kemasan, koreksi sama seperti USDA
        },
    },


    // ─── 5. CALORIE RANGE VARIANCE ─────────────────────────────
    // Seberapa lebar range conservative–likely–upper
    // Fungsi dari kualitas sumber data + metode masak

    range_variance: {
        // Per sumber data (baseline variance)
        by_source: {
            indonesian_dataset: { conservative: 0.87, mid: 1.00, upper: 1.22 },
            usda:               { conservative: 0.88, mid: 1.00, upper: 1.20 },
            openfoodfacts:      { conservative: 0.85, mid: 1.00, upper: 1.25 },
            gemini_estimate:    { conservative: 0.78, mid: 1.00, upper: 1.32 },
            cache:              { conservative: 0.88, mid: 1.00, upper: 1.22 },
            failed:             { conservative: 0.70, mid: 1.00, upper: 1.40 },
        },

        // Tambahan variance untuk metode masak
        // (masak basah/berkuah lebih sulit diukur dari foto)
        by_method: {
            deep_fried:   { extra_low: -0.03, extra_high: +0.05 },
            coconut_milk: { extra_low: -0.05, extra_high: +0.08 },
            stir_fry:     { extra_low: -0.02, extra_high: +0.05 },
            plain:        { extra_low: 0.00,  extra_high: +0.02 },
        },
    },


    // ─── 6. FAST FOOD CHAIN CORRECTIONS ────────────────────────
    // Kalori aktual fast food Indonesia vs nilai database/app resmi
    // Sumber: lab test & beberapa paper independen

    fast_food: {
        // Bias umum: app resmi underreport ~10-15% vs lab measurement
        general_bias:           1.12,

        // Koreksi spesifik per menu populer Indonesia
        // Format: kalori actual per porsi standar
        menu_overrides: {
            // KFC Indonesia
            'kfc original chicken':           { kcal: 390, portion_g: 110 },  // 1 potong
            'kfc crispy':                     { kcal: 420, portion_g: 110 },
            'kfc rice':                       { kcal: 295, portion_g: 200 },  // sepaket
            // McD Indonesia
            'mcdonald big mac':               { kcal: 580, portion_g: 220 },
            'mcdonalds chicken mcdo':         { kcal: 440, portion_g: 170 },
            'mcdonald french fries large':    { kcal: 490, portion_g: 170 },
            // Ayam Geprek / popular chains
            'ayam geprek':                    { kcal: 520, portion_g: 200 },  // nasi + ayam + sambal
            // Indomaret / Alfamart
            'pop mie':                        { kcal: 320, portion_g: 75 },   // siap saji
        },
    },


    // ─── 7. INDONESIAN FOOD SPECIFIC FLOORS ────────────────────
    // Minimum kalori per 100g untuk makanan Indonesia tertentu
    // Cegah dataset mengembalikan angka terlalu rendah

    indonesian_floors: {
        // Makanan santan: pasti tinggi lemak
        'rendang':          { min_kcal_per100g: 240 },   // TKPI 193 → terlalu rendah
        'opor ayam':        { min_kcal_per100g: 130 },
        'soto betawi':      { min_kcal_per100g: 150 },
        'gulai':            { min_kcal_per100g: 130 },
        'sayur lodeh':      { min_kcal_per100g: 70 },

        // Gorengan jalanan
        'martabak':         { min_kcal_per100g: 290 },   // martabak manis sangat tinggi
        'martabak manis':   { min_kcal_per100g: 330 },
        'martabak telur':   { min_kcal_per100g: 280 },
        'pisang goreng':    { min_kcal_per100g: 260 },   // TKPI 246 → masih ok
        'tempe mendoan':    { min_kcal_per100g: 240 },

        // Fast food lokal
        'ayam geprek':      { min_kcal_per100g: 270 },
        'ayam penyet':      { min_kcal_per100g: 260 },

        // Nasi khusus
        'nasi goreng':      { min_kcal_per100g: 185 },   // TKPI 174 → terlalu rendah
        'nasi uduk':        { min_kcal_per100g: 175 },

        // Salted egg / telur asin
        'telur asin':       { min_kcal_per100g: 180 },
        'salted egg':       { min_kcal_per100g: 180 },
        'salted egg sauce': { min_kcal_per100g: 280 },   // saus telur asin = butter+telur
    },


    // ─── TUNING NOTES ───────────────────────────────────────────
    // Cara fine-tune kalau masih under/overcount:
    //
    // Masih undercounting gorengan?
    //   → Naikkan cooking.deep_fried_naked.mid dari 1.28 ke 1.35
    //
    // Nasi goreng masih rendah?
    //   → Naikkan indonesian_floors['nasi goreng'].min_kcal_per100g
    //   → Naikkan cooking.stir_fry_heavy.mid
    //
    // Rendang masih rendah?
    //   → Naikkan indonesian_floors['rendang'].min_kcal_per100g
    //   → Naikkan cooking.coconut_milk.mid
    //
    // Fast food masih rendah?
    //   → Naikkan fast_food.general_bias
    //   → Cek fast_food.menu_overrides
    //
    // Range terlalu sempit / lebar?
    //   → Sesuaikan range_variance.by_source values
};