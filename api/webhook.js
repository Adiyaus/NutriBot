// ============================================================
// api/webhook.js
// Entry point untuk Vercel — handle update dari Telegram via webhook
// Gak pakai bot.launch() karena Vercel serverless, proses mati setelah request
// ============================================================
console.log('[DEBUG] USDA_API_KEY:', process.env.USDA_API_KEY ? 'ADA' : 'TIDAK ADA');
const { Telegraf } = require('telegraf');
const { initReminder } = require('../src/services/reminder');

const {
    handleStart, handleHelp, handleStatus, handleLaporan,
    handleProfil, handleReset, handleHapus, handleAdjust,
    handleStreak, handleTarget, handleRemind,
    handleMenu, handleCatat, handleInput, handleTanya, handleLupain,
    handleScanLabel,
    handleText, handleCallbackQuery, handlePhoto
} = require('../src/handlers/messageHandler');

// Buat instance bot — tanpa launch, cukup untuk handle update
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─── COMMANDS ────────────────────────────────────────────────
bot.start(handleStart);
bot.command('mulai',   handleStart);
bot.command('help',    handleHelp);
bot.command('status',  handleStatus);
bot.command('laporan', handleLaporan);
bot.command('profil',  handleProfil);
bot.command('reset',   handleReset);
bot.command('hapus',   handleHapus);
bot.command('adjust',  handleAdjust);
bot.command('streak',  handleStreak);
bot.command('target',  handleTarget);
bot.command('remind',  handleRemind);
bot.command('menu',    handleMenu);
bot.command('catat',   handleCatat);
bot.command('input',   handleInput);
bot.command('scanlabel', handleScanLabel);
bot.command('tanya',   handleTanya);
bot.command('lupain',  handleLupain);

// ─── MESSAGE HANDLERS ────────────────────────────────────────
bot.on('photo',          handlePhoto);
bot.on('callback_query', handleCallbackQuery);
bot.on('text',           handleText);

// ─── ERROR HANDLER ───────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`[Bot] Error:`, err.message);
    ctx.reply(`😵 Ada error nih. Coba lagi ya!`).catch(() => {});
});

// ─── VERCEL HANDLER ──────────────────────────────────────────
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body);
            res.status(200).json({ ok: true });
        } catch (err) {
            console.error('[Webhook] Error handling update:', err.message);
            res.status(200).json({ ok: false, error: err.message });
            // Tetap return 200 biar Telegram gak retry terus
        }
    } else {
        // GET request — health check
        res.status(200).json({
            status: 'ok',
            bot: process.env.BOT_NAME || 'NutriBot',
            ts: new Date().toISOString()
        });
    }
};