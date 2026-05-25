// ============================================================
// src/utils/progressBar.js
// Progress bar kalori harian berbasis karakter teks
//
// OUTPUT CONTOH:
//   [████████░░░░] 65%
//   [████████████] 100%  ← tepat target
//   [████████████‼] OVER  ← lewat target
//
// CARA PAKAI:
//   const { buildProgressBar } = require('../utils/progressBar');
//   const bar = buildProgressBar(consumed, dailyGoal);
//   // bar.text  → "[████████░░░░] 65%"
//   // bar.emoji → "🟢"
//   // bar.pct   → 65
//   // bar.isOver → false
// ============================================================

const TOTAL_SEGMENTS = 12;   // panjang bar (jumlah karakter di dalam bracket)
const FILL_CHAR      = '█';
const EMPTY_CHAR     = '░';

/**
 * Hitung & render progress bar kalori harian
 *
 * @param {number} consumed  - total kalori terpakai hari ini
 * @param {number} dailyGoal - target kalori harian user
 * @returns {ProgressBarResult}
 */
function buildProgressBar(consumed, dailyGoal) {
    if (!dailyGoal || dailyGoal <= 0) dailyGoal = 2000; // fallback aman

    const rawPct = (consumed / dailyGoal) * 100;
    const pct    = Math.round(Math.min(rawPct, 100));   // cap display di 100
    const isOver = consumed > dailyGoal;
    const over   = Math.round(consumed - dailyGoal);

    // Hitung jumlah segment yang terisi
    const filledCount = Math.round((Math.min(rawPct, 100) / 100) * TOTAL_SEGMENTS);
    const emptyCount  = TOTAL_SEGMENTS - filledCount;

    // Bar string
    const barBody = FILL_CHAR.repeat(filledCount) + EMPTY_CHAR.repeat(Math.max(0, emptyCount));

    let text, emoji, statusLabel;

    if (isOver) {
        // Over budget — bar penuh + tanda seru
        text        = `[${FILL_CHAR.repeat(TOTAL_SEGMENTS)}‼] OVER +${over} kkal`;
        emoji       = '🔴';
        statusLabel = 'over';
    } else if (pct >= 95) {
        // Nyaris habis — hampir penuh
        text        = `[${barBody}] ${pct}%`;
        emoji       = '🟡';
        statusLabel = 'almost';
    } else if (pct >= 75) {
        // Sudah banyak terpakai
        text        = `[${barBody}] ${pct}%`;
        emoji       = '🟠';
        statusLabel = 'high';
    } else if (pct >= 30) {
        // Normal — on track
        text        = `[${barBody}] ${pct}%`;
        emoji       = '🟢';
        statusLabel = 'normal';
    } else if (pct > 0) {
        // Baru mulai
        text        = `[${barBody}] ${pct}%`;
        emoji       = '🟢';
        statusLabel = 'low';
    } else {
        // Kosong (consumed = 0, dipakai setelah first log tapi masih 0 edge case)
        text        = `[${'░'.repeat(TOTAL_SEGMENTS)}] 0%`;
        emoji       = '🟢';
        statusLabel = 'empty';
    }

    return {
        text,           // string siap pakai → "[████████░░░░] 65%"
        emoji,          // status emoji berdasarkan level
        pct,            // persentase 0-100
        rawPct,         // persentase asli (bisa >100 kalau over)
        isOver,         // boolean
        over,           // kkal over (0 kalau tidak over)
        statusLabel,    // 'empty' | 'low' | 'normal' | 'high' | 'almost' | 'over'
        consumed:  Math.round(consumed),
        dailyGoal: Math.round(dailyGoal),
        remaining: Math.round(Math.max(0, dailyGoal - consumed)),
    };
}

/**
 * Versi ringkas untuk satu baris (tanpa bracket, cocok untuk inline)
 *
 * @param {number} consumed
 * @param {number} dailyGoal
 * @returns {string}  contoh: "65% of 2000 kkal"
 */
function buildProgressCompact(consumed, dailyGoal) {
    const { pct, isOver, over } = buildProgressBar(consumed, dailyGoal);
    if (isOver) return `OVER +${over} kkal dari target`;
    return `${pct}% dari ${Math.round(dailyGoal)} kkal`;
}

module.exports = { buildProgressBar, buildProgressCompact };

/**
 * @typedef {Object} ProgressBarResult
 * @property {string}  text        - bar string siap pakai
 * @property {string}  emoji       - status emoji (🟢🟠🟡🔴)
 * @property {number}  pct         - persentase 0-100
 * @property {number}  rawPct      - persentase asli (bisa >100)
 * @property {boolean} isOver      - apakah over budget
 * @property {number}  over        - kkal over budget (0 jika tidak)
 * @property {string}  statusLabel - 'empty'|'low'|'normal'|'high'|'almost'|'over'
 * @property {number}  consumed    - total terpakai (rounded)
 * @property {number}  dailyGoal   - target harian (rounded)
 * @property {number}  remaining   - sisa (0 jika over)
 */