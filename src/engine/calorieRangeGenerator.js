// ============================================================
// src/engine/calorieRangeGenerator.js
// Layer 4: Calorie Range Generator
//
// MASALAH YANG DIPECAHKAN:
//   Output "537 kcal" memberikan kesan presisi yang tidak ada.
//   Realita: estimasi dari foto makanan punya uncertainty ±20-35%.
//   User yang sedang diet HARUS tahu range ini agar tidak salah planning.
//
// OUTPUT FORMAT:
//   {
//     conservative: 450,   // kemungkinan batas bawah (mungkin lebih sedikit minyak)
//     likely:       620,   // estimasi paling realistis
//     upper:        780,   // kemungkinan batas atas (porsi besar, ekstra minyak)
//     display_text: "620 kcal (kisaran: 450–780)",
//     uncertainty_pct: 25, // ±25% dari likely
//   }
//
// CARA MENGHITUNG RANGE:
//   1. Mulai dari "likely" = hasil setelah cooking adjustment + portion scaling
//   2. Conservative = likely × source_variance.conservative (e.g. 0.87)
//   3. Upper = likely × source_variance.upper (e.g. 1.22)
//   4. Adjust variance berdasarkan metode masak (goreng = variance lebih lebar)
//   5. Round ke nearest 5 untuk display (mengurangi false precision)
// ============================================================

const M = require('../config/realisticMultipliers');

// ─── RANGE GENERATION ─────────────────────────────────────────

/**
 * Generate calorie range dari single likely estimate
 *
 * @param {number} likelyCalories - hasil adjusted calories (after cooking + portion)
 * @param {string} dominantSource - sumber data dominan ('usda', 'gemini_estimate', dll)
 * @param {string} cookingMethod  - metode masak yang terdeteksi ('deep_fried_naked', dll)
 * @param {string} [overallConfidence='medium'] - 'high', 'medium', 'low'
 * @returns {CalorieRange}
 */
function generateCalorieRange(likelyCalories, dominantSource, cookingMethod, overallConfidence = 'medium') {
    const likely = Math.round(likelyCalories);

    // Base variance dari sumber data
    const sourceVariance = M.range_variance.by_source[dominantSource]
        || M.range_variance.by_source['gemini_estimate'];

    // Extra variance dari metode masak
    const methodGroup = _getCookingMethodGroup(cookingMethod);
    const methodVariance = M.range_variance.by_method[methodGroup]
        || M.range_variance.by_method['plain'];

    // Gabungkan variance
    const conservativeMultiplier = sourceVariance.conservative + (methodVariance.extra_low  || 0);
    const upperMultiplier        = sourceVariance.upper        + (methodVariance.extra_high || 0);

    // Kalau confidence rendah, lebarkan range
    const confidenceExpansion = overallConfidence === 'low' ? 0.05 : 0;
    const conservativeFinal   = Math.max(conservativeMultiplier - confidenceExpansion, 0.60);
    const upperFinal          = upperMultiplier + confidenceExpansion;

    // Hitung range
    let conservative = Math.round(likely * conservativeFinal);
    let upper        = Math.round(likely * upperFinal);

    // Round ke nearest 5 (kurangi false precision)
    conservative = _roundToNearest5(conservative);
    upper        = _roundToNearest5(upper);
    const likelyRounded = _roundToNearest5(likely);

    // Safety: ensure ordering
    conservative = Math.min(conservative, likelyRounded);
    upper        = Math.max(upper, likelyRounded);

    // Uncertainty percentage
    const uncertainty_pct = Math.round(((upper - conservative) / 2 / likelyRounded) * 100);

    return {
        conservative,
        likely: likelyRounded,
        upper,
        display_text:     _formatDisplayText(conservative, likelyRounded, upper),
        uncertainty_pct,
        source_variance:  sourceVariance,
        cooking_method:   cookingMethod,
        confidence:       overallConfidence,
    };
}

/**
 * Generate full macro range (calories + protein + carbs + fat)
 * Protein variance lebih kecil dari calories (protein tidak berubah banyak karena minyak)
 *
 * @param {object} likelyNutrition - { calories, protein_g, carbs_g, fat_g }
 * @param {string} dominantSource
 * @param {string} cookingMethod
 * @param {string} [overallConfidence='medium']
 * @returns {MacroRange}
 */
function generateMacroRange(likelyNutrition, dominantSource, cookingMethod, overallConfidence = 'medium') {
    const calRange = generateCalorieRange(
        likelyNutrition.calories,
        dominantSource,
        cookingMethod,
        overallConfidence
    );

    const sourceVariance = M.range_variance.by_source[dominantSource]
        || M.range_variance.by_source['gemini_estimate'];

    // Fat range: lebih lebar dari calories (paling terpengaruh minyak)
    const fatLikely = likelyNutrition.fat_g || 0;
    const fatConservative = parseFloat((fatLikely * (sourceVariance.conservative - 0.03)).toFixed(1));
    const fatUpper        = parseFloat((fatLikely * (sourceVariance.upper + 0.05)).toFixed(1));

    // Protein range: sempit (protein tidak berubah banyak)
    const proteinLikely = likelyNutrition.protein_g || 0;
    const proteinConservative = parseFloat((proteinLikely * (sourceVariance.conservative + 0.05)).toFixed(1));
    const proteinUpper        = parseFloat((proteinLikely * (sourceVariance.upper - 0.05)).toFixed(1));

    // Carbs range: medium variance
    const carbsLikely = likelyNutrition.carbs_g || 0;
    const carbsConservative = parseFloat((carbsLikely * sourceVariance.conservative).toFixed(1));
    const carbsUpper        = parseFloat((carbsLikely * sourceVariance.upper).toFixed(1));

    return {
        calories:  calRange,
        protein_g: {
            conservative: Math.max(0, proteinConservative),
            likely:       parseFloat(proteinLikely.toFixed(1)),
            upper:        proteinUpper,
        },
        carbs_g: {
            conservative: Math.max(0, carbsConservative),
            likely:       parseFloat(carbsLikely.toFixed(1)),
            upper:        carbsUpper,
        },
        fat_g: {
            conservative: Math.max(0, fatConservative),
            likely:       parseFloat(fatLikely.toFixed(1)),
            upper:        fatUpper,
        },

        // Summary untuk display
        summary: {
            calories:      calRange.display_text,
            protein:       `${proteinConservative}–${proteinUpper}g`,
            carbs:         `${carbsConservative}–${carbsUpper}g`,
            fat:           `${fatConservative}–${fatUpper}g`,
            uncertainty:   calRange.uncertainty_pct,
            cooking_note:  _getCookingNote(cookingMethod),
        },
    };
}

/**
 * Format range untuk display di Telegram
 * Returns multi-line string siap pakai
 *
 * @param {MacroRange} macroRange
 * @param {string} [foodDescription]
 * @returns {string}
 */
function formatRangeForTelegram(macroRange, foodDescription = '') {
    const cal = macroRange.calories;
    const { protein_g, carbs_g, fat_g, summary } = macroRange;

    const lines = [];

    if (foodDescription) {
        lines.push(`🍽️ *${foodDescription}*`);
    }

    lines.push('');
    lines.push(`📊 *Estimasi Kalori:*`);
    lines.push(`  Conservative: *${cal.conservative} kcal*`);
    lines.push(`  Most Likely:  *${cal.likely} kcal* ← pakai ini`);
    lines.push(`  Upper Bound:  *${cal.upper} kcal*`);
    lines.push('');
    lines.push(`🥗 *Makro (Most Likely):*`);
    lines.push(`  Protein: ${protein_g.likely}g (${protein_g.conservative}–${protein_g.upper}g)`);
    lines.push(`  Karbs:   ${carbs_g.likely}g (${carbs_g.conservative}–${carbs_g.upper}g)`);
    lines.push(`  Lemak:   ${fat_g.likely}g (${fat_g.conservative}–${fat_g.upper}g)`);

    if (summary.cooking_note) {
        lines.push('');
        lines.push(`🔥 *Catatan Memasak:* ${summary.cooking_note}`);
    }

    lines.push('');
    lines.push(`⚠️ _Uncertainty: ±${summary.uncertainty}% — estimasi visual dari foto_`);

    return lines.join('\n');
}

/**
 * Compact format untuk summary (1-liner)
 *
 * @param {CalorieRange} calRange
 * @returns {string}
 */
function formatCompact(calRange) {
    return `~${calRange.likely} kcal (${calRange.conservative}–${calRange.upper})`;
}

// ─── HELPERS ──────────────────────────────────────────────────

function _getCookingMethodGroup(method) {
    const fryMethods = [
        'deep_fried_naked', 'deep_fried_battered', 'deep_fried_breaded', 'geprek_penyet'
    ];
    if (fryMethods.includes(method)) return 'deep_fried';

    const coconutMethods = ['coconut_milk'];
    if (coconutMethods.includes(method)) return 'coconut_milk';

    const stfrMethods = ['stir_fry_light', 'stir_fry_heavy', 'pan_fried'];
    if (stfrMethods.includes(method)) return 'stir_fry';

    return 'plain';
}

function _formatDisplayText(conservative, likely, upper) {
    return `${likely} kcal (kisaran: ${conservative}–${upper})`;
}

function _roundToNearest5(n) {
    return Math.round(n / 5) * 5;
}

function _getCookingNote(cookingMethod) {
    const notes = {
        'deep_fried_naked':    'Gorengan: absorpsi minyak tinggi. Range lebar karena variasi minyak.',
        'deep_fried_battered': 'Gorengan batter: coating menyerap minyak ekstra. Kalori bisa jauh lebih tinggi.',
        'deep_fried_breaded':  'Crispy/breaded: tepung panir menyerap minyak, naikkan kalori signifikan.',
        'coconut_milk':        'Santan: lemak tinggi. Semakin kental kuah = semakin banyak kalori.',
        'stir_fry_heavy':      'Tumis/goreng-goreng: minyak wok warung banyak, termasuk bumbu.',
        'geprek_penyet':       'Geprek/penyet: double-fry + sambal minyak. Kalori lebih tinggi dari ayam goreng biasa.',
        'grilled_marinade':    'Ayam bakar/sate: marinade mengandung kecap manis + minyak.',
        'heavy_sauce':         'Bumbu kental: saus mengandung minyak + gula yang signifikan.',
        'plain':               null,
    };
    return notes[cookingMethod] || null;
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    generateCalorieRange,
    generateMacroRange,
    formatRangeForTelegram,
    formatCompact,
};

/**
 * @typedef {Object} CalorieRange
 * @property {number} conservative
 * @property {number} likely
 * @property {number} upper
 * @property {string} display_text
 * @property {number} uncertainty_pct
 * @property {string} cooking_method
 * @property {string} confidence
 */

/**
 * @typedef {Object} MacroRange
 * @property {CalorieRange} calories
 * @property {{ conservative, likely, upper }} protein_g
 * @property {{ conservative, likely, upper }} carbs_g
 * @property {{ conservative, likely, upper }} fat_g
 * @property {{ calories, protein, carbs, fat, uncertainty, cooking_note }} summary
 */