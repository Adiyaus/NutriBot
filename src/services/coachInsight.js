// ============================================================
// src/services/coachInsight.js
// Generate 1-kalimat coach feedback kontekstual setelah log makanan
//
// FITUR:
//   - Analisis makanan yang baru di-log vs sisa kalori hari ini
//   - Tone: friendly, casual, millennial/Gen-Z Indonesian slang
//   - Output: 1 kalimat singkat — no essay, no sermon
//   - Non-blocking: dipanggil fire-and-forget, failure tidak crash main flow
//
// CARA PAKAI:
//   const { generateAndSendInsight } = require('../services/coachInsight');
//
//   // Panggil SETELAH main message sudah terkirim
//   // Fire and forget — gak perlu await di luar
//   generateAndSendInsight(ctx, { user, mealResult, summary }).catch(() => {});
//
// TONE GUIDELINE (anak tongkrongan):
//   ✅ "Aduh bro, nasi goreng 2 porsi? Sisa kuotamu dikit banget nih!"
//   ✅ "Mantap! Protein lo udah bagus, tinggal jaga portion malem ini!"
//   ✅ "Hati-hati bestie, kalau makan lagi ntar over target deh"
//   ✅ "Wah tipis banget sisanya, mending ngemil buah aja kalo laper"
//   ❌ "Selamat! Anda telah mengonsumsi makanan bergizi." (terlalu formal)
//   ❌ "Harap berhati-hati dengan asupan kalori Anda." (terlalu kaku)
// ============================================================

const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

// ─── INSIGHT TONE CATEGORIES ──────────────────────────────────
// Dipakai untuk enriched context ke Gemini — biar lebih targeted

const INSIGHT_CONTEXT = {
    DANGER:   'over',     // udah over budget
    CRITICAL: 'critical', // sisa < 100 kkal
    WARNING:  'warning',  // sisa < 300 kkal
    HEALTHY:  'healthy',  // sisa 300-600 kkal, on track
    PLENTY:   'plenty',   // sisa banyak, awal hari
};

function classifyRemaining(remaining, dailyGoal) {
    if (remaining < 0)                        return INSIGHT_CONTEXT.DANGER;
    if (remaining < 100)                      return INSIGHT_CONTEXT.CRITICAL;
    if (remaining < 300)                      return INSIGHT_CONTEXT.WARNING;
    if (remaining < dailyGoal * 0.35)         return INSIGHT_CONTEXT.HEALTHY;  // sisa < 35%
    return INSIGHT_CONTEXT.PLENTY;
}

function classifyMealDensity(calories) {
    if (calories >= 800)  return 'very_heavy';   // makanan berat banget
    if (calories >= 500)  return 'heavy';         // lumayan berat
    if (calories >= 300)  return 'moderate';      // normal
    if (calories >= 150)  return 'light';         // ringan
    return 'snack';                               // camilan
}

// ─── SLANG EXAMPLES ───────────────────────────────────────────
// Diinjeksi ke prompt biar Gemini paham register bahasanya

const SLANG_EXAMPLES = [
    'bro / bestie / gaes / cuy',
    'ngikutin plan / on track / gak bocor',
    'aduh / waduh / duh / wah',
    'mayan / lumayan / cukup sih',
    'ngabisin kuota / sisa dikit / hampir penuh',
    'heavy / ringan / oke banget',
    'jangan lupa / inget ya / perhatiin',
    'gue / lo / dia (bukan saya/anda/kamu)',
    'gak / gue / gimana / kalo / tapi',
    'mantap / oke / worth it / chill aja',
];

// ─── PROMPT BUILDER ───────────────────────────────────────────

function buildInsightPrompt(user, mealResult, summary, bar) {
    const remaining     = bar.remaining;
    const consumed      = bar.consumed;
    const dailyGoal     = bar.dailyGoal;
    const pct           = bar.pct;
    const isOver        = bar.isOver;
    const budgetCtx     = classifyRemaining(remaining, dailyGoal);
    const mealDensity   = classifyMealDensity(mealResult.calories);
    const mealName      = mealResult.food_description || 'makanan';
    const mealKcal      = Math.round(mealResult.calories);
    const mealProtein   = parseFloat(mealResult.protein_g || 0).toFixed(0);
    const mealCarbs     = parseFloat(mealResult.carbs_g   || 0).toFixed(0);
    const mealFat       = parseFloat(mealResult.fat_g     || 0).toFixed(0);
    const userName      = user.name || 'gaes';
    const gender        = user.gender || 'pria';

    // Sapaan berdasarkan gender — biar lebih personal
    const sapaan = gender === 'wanita' ? 'bestie' : 'bro';

    return `
Kamu adalah AI coach nutrisi NutriBot. Tugasmu: buat SATU kalimat singkat sebagai feedback setelah user log makanan.

DATA USER:
- Nama: ${userName} (sapaan: "${sapaan}")
- Target kalori: ${dailyGoal} kkal/hari
- Sudah terpakai: ${consumed} kkal (${pct}%)
- Sisa kalori: ${isOver ? 'OVER ' + Math.abs(remaining) + ' kkal' : remaining + ' kkal'}

MAKANAN YANG BARU DI-LOG:
- Nama: ${mealName}
- Kalori: ${mealKcal} kkal
- Protein: ${mealProtein}g | Karbo: ${mealCarbs}g | Lemak: ${mealFat}g
- Kategori makanan: ${mealDensity}
- Status kuota: ${budgetCtx}

TONE & GAYA BAHASA:
- Casual, friendly, gaya anak tongkrongan / Gen-Z Indonesia
- Gunakan salah satu dari: ${SLANG_EXAMPLES.join(', ')}
- Pakai kata ganti: gue/lo (bukan saya/anda)
- Boleh pake emoji 1-2 tapi jangan lebay
- PENTING: SATU kalimat saja — tidak lebih, tidak pakai titik lebih dari satu

PANDUAN KONTEKS:
${budgetCtx === 'over'     ? `- User OVER BUDGET. Tone: sabar, gak judging, encourage besok lebih baik` : ''}
${budgetCtx === 'critical' ? `- Sisa kuota SANGAT TIPIS (<100 kkal). Ingatkan dengan santai untuk hati-hati malam ini` : ''}
${budgetCtx === 'warning'  ? `- Sisa kuota TIPIS (<300 kkal). Rekomendasikan camilan ringan atau air putih` : ''}
${budgetCtx === 'healthy'  ? `- On track! Beri pujian tapi tetap remind untuk jaga sisa hari ini` : ''}
${budgetCtx === 'plenty'   ? `- Sisa masih banyak. Bisa motivasi, atau kasih insight soal makro (protein/karbo/lemak)` : ''}
${mealDensity === 'very_heavy' ? `- Makanannya BERAT BANGET (${mealKcal} kkal). Acknowledge itu dengan santai` : ''}
${mealDensity === 'heavy'      ? `- Makanan cukup berat. Bisa kasih saran porsi berikutnya` : ''}
${parseFloat(mealProtein) >= 25 ? `- Protein bagus (${mealProtein}g)! Bisa highlight ini` : ''}

CONTOH OUTPUT YANG BENAR:
- "Nasi goreng lo lumayan heavy nih ${sapaan}, sisa ${remaining} kkal buat malem — mending makan ringan aja 🌙"
- "Wah protein lo udah mantap dari makan ini, on track terus ya biar target gak bocor! 💪"  
- "Aduh tipis banget sisanya ${sapaan}, kalau laper makan buah aja atau minum air dulu"
- "Lo udah ${pct}% dari target cuy, masih ada ruang buat 1-2 camilan ringan kok"

CONTOH OUTPUT YANG SALAH (jangan kayak gini):
- "Selamat! Anda telah mengonsumsi makanan yang bergizi." (terlalu formal)
- "Harap perhatikan asupan kalori harian Anda." (terlalu kaku)
- "Makanan ini mengandung 500 kalori. Sisa kalori Anda adalah 300." (terlalu report-y)

Balas HANYA satu kalimat feedback-nya saja. Tidak ada label, tidak ada JSON, tidak ada penjelasan tambahan.
    `.trim();
}

// ─── GEMINI CALLER (TEXT MODE) ────────────────────────────────

async function callGeminiText(prompt) {
    // Load key langsung dari env — ikuti pola key rotation dari gemini.js
    const keys = [];
    for (let i = 1; i <= 10; i++) {
        const k = process.env[`GEMINI_API_KEY_${i}`];
        if (k) keys.push(k);
    }
    if (keys.length === 0 && process.env.GEMINI_API_KEY) {
        keys.push(process.env.GEMINI_API_KEY);
    }
    if (keys.length === 0) throw new Error('No Gemini key');

    // Coba tiap key — simple rotation untuk insight (non-critical)
    for (const key of keys) {
        try {
            const client   = new GoogleGenAI({ apiKey: key });
            const response = await client.models.generateContent({
                model:    'gemini-2.5-flash-lite',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    temperature: 0.85,    // lebih tinggi dari default → lebih kreatif/kasual
                    topP:        0.92,
                    // TIDAK set responseMimeType JSON — kita mau plain text
                },
            });
            return response.text?.trim() || null;
        } catch (err) {
            const isRateLimit = String(err).includes('429') || String(err).includes('quota');
            if (isRateLimit) continue; // coba key berikutnya
            throw err;
        }
    }
    throw new Error('RATE_LIMIT');
}

// ─── SANITIZER ────────────────────────────────────────────────

/**
 * Bersihkan output Gemini:
 *   - Strip quotes kalau Gemini wrap dengan "..." atau '...'
 *   - Pastikan tidak lebih dari 2 kalimat (ambil kalimat pertama)
 *   - Pastikan aman untuk Markdown Telegram
 */
function sanitizeInsight(raw) {
    if (!raw || typeof raw !== 'string') return null;

    let text = raw.trim();

    // Strip outer quotes kalau ada
    if ((text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1).trim();
    }

    // Ambil hanya kalimat pertama kalau ada lebih dari satu
    const firstSentence = text.split(/[.!?]\s+/)[0];
    if (firstSentence && firstSentence.length > 10) {
        // Tambah kembali punctuation yang hilang kalau kalimat aslinya punya
        const hasEndPunct = /[.!?]$/.test(firstSentence);
        text = hasEndPunct ? firstSentence : firstSentence + '!';
    }

    // Panjang wajar: 20-200 karakter
    if (text.length < 15 || text.length > 220) return null;

    // Escape Markdown characters yang bisa merusak format Telegram
    // Biarkan * dan _ (untuk bold/italic) tapi hati-hati karakter lain
    text = text
        .replace(/\[(?!█|░)/g, '\\[')   // escape [ tapi bukan progress bar chars
        .replace(/`/g, "'");             // backtick → apostrophe (aman di Telegram)

    return text;
}

// ─── MAIN EXPORTED FUNCTION ───────────────────────────────────

/**
 * Generate insight dan langsung kirim sebagai pesan terpisah ke Telegram.
 * Dipanggil fire-and-forget setelah main result message terkirim.
 *
 * @param {object} ctx          - Telegram context (dari telegraf)
 * @param {object} params
 * @param {object} params.user        - user object dari DB
 * @param {object} params.mealResult  - result dari nutritionResolver
 * @param {object} params.summary     - daily summary dari DB
 * @param {object} params.bar         - ProgressBarResult dari buildProgressBar
 */
async function generateAndSendInsight(ctx, { user, mealResult, summary, bar }) {
    try {
        const prompt   = buildInsightPrompt(user, mealResult, summary, bar);
        const rawText  = await callGeminiText(prompt);
        const insight  = sanitizeInsight(rawText);

        if (!insight) {
            console.warn('[CoachInsight] Output tidak valid, skip send');
            return;
        }

        // Kirim sebagai pesan baru (bukan edit) — biar subtle, muncul setelah main result
        await ctx.reply(
            `💡 *NutriTips:* ${insight}`,
            { parse_mode: 'Markdown' }
        );

        console.log(`[CoachInsight] Sent for user ${user.telegram_id || ctx.from.id}: "${insight}"`);

    } catch (err) {
        // Silent failure — insight adalah bonus, bukan fitur utama
        console.warn('[CoachInsight] Failed (silent):', err.message);
    }
}

/**
 * Versi pure (hanya return string, tidak kirim) — untuk testing / custom formatting
 *
 * @param {object} user
 * @param {object} mealResult
 * @param {object} summary
 * @param {object} bar - ProgressBarResult
 * @returns {Promise<string|null>}
 */
async function generateInsightText(user, mealResult, summary, bar) {
    try {
        const prompt  = buildInsightPrompt(user, mealResult, summary, bar);
        const rawText = await callGeminiText(prompt);
        return sanitizeInsight(rawText);
    } catch {
        return null;
    }
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    generateAndSendInsight,
    generateInsightText,
    classifyRemaining,
    classifyMealDensity,
};