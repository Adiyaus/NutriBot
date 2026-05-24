// ============================================================
// src/engine/confidenceScorer.js
// Layer 5: Confidence Scoring System
//
// MASALAH YANG DIPECAHKAN:
//   "high", "medium", "low" tidak cukup informatif.
//   User perlu tahu:
//     - Kenapa confidence rendah?
//     - Berapa % variance yang harus diperhitungkan?
//     - Apakah foto-nya kurang jelas?
//     - Apakah ada item yang gagal di-resolve?
//
// OUTPUT:
//   {
//     score: 0–100,          // numeric score
//     level: 'high'|'medium'|'low',
//     variance_pct: 15,      // expected variance (± dari likely)
//     reasons: ['...'],      // human-readable reasons
//     display_badge: '✅',   // untuk Telegram
//     disclaimer: '...',     // kalau low confidence, kasih disclaimer
//   }
//
// SCORING COMPONENTS:
//   Base score = 100
//   Penalties:
//     - Gemini estimate source: -20 per item
//     - Failed item: -25 per item
//     - Low coverage: -15
//     - Multi-source: -5
//     - No cooking method detected: -5
//     - Image confidence low (dari Gemini): -10
//   Bonuses:
//     - All indonesian_dataset: +5
//     - All USDA: +3
//     - High portion confidence: +5
// ============================================================

const M = require('../config/realisticMultipliers');

// ─── SCORING CONFIG ───────────────────────────────────────────

const SCORE_PENALTIES = {
    gemini_estimate_per_item:  -20,
    failed_item_per_item:      -25,
    low_coverage:              -15,    // coverage < 60%
    medium_coverage:           -8,     // coverage 60-80%
    multi_source:              -5,
    no_cooking_method:         -5,     // detected method = pan_fried with low confidence
    image_confidence_low:      -12,    // Gemini vision confidence = low
    image_confidence_medium:   -5,
    openfoodfacts_incomplete:  -8,     // OFF completeness < 0.5
    invisible_items_present:   -3,     // invisible calories ditambahkan = ada uncertainty
};

const SCORE_BONUSES = {
    all_indonesian_dataset:    +8,
    all_usda:                  +5,
    high_cooking_confidence:   +5,
    explicit_portion:          +8,    // user kasih berat eksplisit
    high_coverage:             +5,    // coverage = 100%
};

// ─── MAIN SCORER ──────────────────────────────────────────────

/**
 * Hitung confidence score dari resolved items + context
 *
 * @param {object} params
 * @param {Array}  params.resolvedItems      - array hasil _resolveOneItem
 * @param {string} params.dominantSource     - sumber dominan
 * @param {string} params.geminiConfidence   - confidence dari Gemini vision ('high'|'medium'|'low')
 * @param {object} params.cookingDetection   - hasil detectCookingMethod
 * @param {object} params.portionDetection   - hasil applyPortionScaling
 * @param {boolean} params.hasInvisibleCalories - apakah invisible calories ditambahkan
 * @param {boolean} params.userExplicitPortion  - apakah user kasih berat eksplisit
 * @returns {ConfidenceResult}
 */
function scoreConfidence({
    resolvedItems = [],
    dominantSource = 'gemini_estimate',
    geminiConfidence = 'medium',
    cookingDetection = null,
    portionDetection = null,
    hasInvisibleCalories = false,
    userExplicitPortion = false,
}) {
    let score = 100;
    const reasons = [];
    const bonuses = [];

    const totalCount    = resolvedItems.length;
    const resolvedCount = resolvedItems.filter(i => i.resolved).length;
    const coverage      = totalCount > 0 ? resolvedCount / totalCount : 0;
    const geminiCount   = resolvedItems.filter(i => i.source === 'gemini_estimate').length;
    const failedCount   = resolvedItems.filter(i => !i.resolved).length;

    const sources = [...new Set(resolvedItems.filter(i => i.resolved).map(i => i.source))];

    // ── Penalties ────────────────────────────────────────────

    // Gemini estimate items
    if (geminiCount > 0) {
        const pen = SCORE_PENALTIES.gemini_estimate_per_item * geminiCount;
        score += pen;
        reasons.push(`${geminiCount} item diestimasi Gemini AI (±30% uncertainty)`);
    }

    // Failed items
    if (failedCount > 0) {
        const pen = SCORE_PENALTIES.failed_item_per_item * failedCount;
        score += pen;
        reasons.push(`${failedCount} item gagal diidentifikasi`);
    }

    // Coverage
    if (coverage < 0.6) {
        score += SCORE_PENALTIES.low_coverage;
        reasons.push(`Coverage rendah (${Math.round(coverage * 100)}% item teridentifikasi)`);
    } else if (coverage < 0.8) {
        score += SCORE_PENALTIES.medium_coverage;
        reasons.push(`Coverage medium (${Math.round(coverage * 100)}% item teridentifikasi)`);
    }

    // Multi-source
    if (sources.length > 2) {
        score += SCORE_PENALTIES.multi_source;
        reasons.push('Data dari multiple sumber berbeda');
    }

    // Cooking method confidence
    if (cookingDetection && cookingDetection.confidence === 'low') {
        score += SCORE_PENALTIES.no_cooking_method;
        reasons.push('Metode masak tidak dapat dideteksi dengan pasti');
    }

    // Gemini vision confidence
    if (geminiConfidence === 'low') {
        score += SCORE_PENALTIES.image_confidence_low;
        reasons.push('Foto kurang jelas atau makanan sulit diidentifikasi');
    } else if (geminiConfidence === 'medium') {
        score += SCORE_PENALTIES.image_confidence_medium;
    }

    // Invisible calories
    if (hasInvisibleCalories) {
        score += SCORE_PENALTIES.invisible_items_present;
        reasons.push('Ada komponen tersembunyi (sambal, kecap, dll) yang diestimasi');
    }

    // ── Bonuses ──────────────────────────────────────────────

    // All from Indonesian dataset
    if (sources.length === 1 && sources[0] === 'indonesian_dataset') {
        score += SCORE_BONUSES.all_indonesian_dataset;
        bonuses.push('Semua dari dataset Indonesia (TKPI)');
    }

    // All from USDA
    if (sources.length === 1 && sources[0] === 'usda') {
        score += SCORE_BONUSES.all_usda;
        bonuses.push('Semua dari USDA FoodData Central');
    }

    // High cooking confidence
    if (cookingDetection && cookingDetection.confidence === 'high') {
        score += SCORE_BONUSES.high_cooking_confidence;
    }

    // User explicit portion
    if (userExplicitPortion) {
        score += SCORE_BONUSES.explicit_portion;
        bonuses.push('Berat porsi diberikan eksplisit oleh user');
    }

    // Full coverage
    if (coverage === 1.0 && totalCount > 0) {
        score += SCORE_BONUSES.high_coverage;
    }

    // ── Clamp & Classify ─────────────────────────────────────
    score = Math.max(0, Math.min(100, score));

    const level        = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
    const variance_pct = _scoreToVariance(score);
    const display_badge = _badge(level);
    const disclaimer   = _disclaimer(level, variance_pct, reasons);

    return {
        score,
        level,
        variance_pct,
        reasons,
        bonuses,
        display_badge,
        disclaimer,
        coverage_pct: Math.round(coverage * 100),
        sources_used: sources,
        dominant_source: dominantSource,
    };
}

// ─── SIMPLE CONFIDENCE DOWNGRADE ─────────────────────────────
// Untuk backward compatibility dengan kode lama yang pakai string

/**
 * Downgrade confidence string berdasarkan kondisi
 * @param {string} current - 'high', 'medium', 'low'
 * @param {boolean[]} conditions - array of conditions yang bisa downgrade
 * @returns {string}
 */
function downgradedConfidence(current, conditions = []) {
    const levels = ['high', 'medium', 'low'];
    let idx = levels.indexOf(current);
    if (idx === -1) idx = 1;

    for (const condition of conditions) {
        if (condition && idx < levels.length - 1) {
            idx++;
        }
    }

    return levels[idx];
}

/**
 * Build disclaimer message untuk Telegram (kalau diperlukan)
 *
 * @param {ConfidenceResult} confidenceResult
 * @returns {string|null}
 */
function buildDisclaimerMessage(confidenceResult) {
    if (confidenceResult.level === 'high') return null;

    const { level, variance_pct, reasons } = confidenceResult;
    const emoji = level === 'medium' ? '⚠️' : '❗';

    let msg = `${emoji} *Estimasi Visual — Akurasi Terbatas*\n`;
    msg += `Kalori aktual bisa beda ±${variance_pct}% dari estimasi.\n`;

    if (reasons.length > 0) {
        msg += '\nAlasan ketidakpastian:\n';
        reasons.forEach(r => { msg += `• ${r}\n`; });
    }

    return msg;
}

// ─── HELPERS ──────────────────────────────────────────────────

function _scoreToVariance(score) {
    // score 100 → ±10%, score 0 → ±40%
    return Math.round(10 + (100 - score) * 0.30);
}

function _badge(level) {
    if (level === 'high')   return '✅';
    if (level === 'medium') return '⚠️';
    return '❗';
}

function _disclaimer(level, variance_pct, reasons) {
    if (level === 'high') return null;

    const base = `Estimasi visual. Kalori aktual bisa beda ±${variance_pct}%.`;

    if (level === 'low') {
        return base + ' Sebaiknya cross-check dengan label/menu atau tambahkan konteks.';
    }

    return base;
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    scoreConfidence,
    downgradedConfidence,
    buildDisclaimerMessage,
};

/**
 * @typedef {Object} ConfidenceResult
 * @property {number}   score            - 0–100
 * @property {string}   level            - 'high'|'medium'|'low'
 * @property {number}   variance_pct     - expected variance percentage
 * @property {string[]} reasons          - why confidence is lower
 * @property {string[]} bonuses          - why confidence is higher
 * @property {string}   display_badge    - emoji badge
 * @property {string|null} disclaimer    - disclaimer text
 * @property {number}   coverage_pct
 * @property {string[]} sources_used
 * @property {string}   dominant_source
 */