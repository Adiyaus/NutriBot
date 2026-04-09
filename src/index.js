// ============================================================
// src/index.js
// Update: tambah handler /reset dan /adjust
// ============================================================

require('dotenv').config();

const { Telegraf } = require('telegraf');

const {
    handleStart,
    handleHelp,
    handleStatus,
    handleLaporan,
    handleProfil,
    handleReset,
    handleAdjust,
    handleText,
    handleCallbackQuery,
    handlePhoto
} = require('./handlers/messageHandler');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─── COMMANDS ────────────────────────────────────────────────
bot.start(handleStart);
bot.command('mulai',   handleStart);
bot.command('help',    handleHelp);
bot.command('status',  handleStatus);
bot.command('laporan', handleLaporan);
bot.command('profil',  handleProfil);
bot.command('reset',   handleReset);
bot.command('adjust',  handleAdjust);

// ─── MESSAGE HANDLERS ────────────────────────────────────────
bot.on('photo',          handlePhoto);
bot.on('callback_query', handleCallbackQuery);
bot.on('text',           handleText);

// ─── ERROR HANDLER ───────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`[Bot] Error:`, err.message);
    ctx.reply(`😵 Ada error nih. Coba lagi ya!`).catch(() => {});
});

// ─── START ───────────────────────────────────────────────────
bot.launch()
    .then(() => {
        console.log(`\n✅ ${process.env.BOT_NAME || 'NutriBot'} aktif!`);
        console.log(`⏰ Started: ${new Date().toLocaleString('id-ID')}\n`);
    })
    .catch(err => {
        console.error('❌ Gagal start bot:', err.message);
        process.exit(1);
    });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));