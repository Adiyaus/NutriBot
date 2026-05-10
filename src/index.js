// src/index.js
require('dotenv').config();

const { Telegraf }      = require('telegraf');
const http              = require('http'); // built-in Node.js, gak perlu install
const { initReminder }  = require('./services/reminder');

const {
    handleStart, handleHelp, handleStatus, handleLaporan,
    handleProfil, handleReset, handleHapus, handleAdjust,
    handleStreak, handleTarget, handleRemind,
    handleMenu, handleCatat, handleInput, handleTanya, handleLupain,
    handleText, handleCallbackQuery, handlePhoto
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
bot.command('hapus',   handleHapus);
bot.command('adjust',  handleAdjust);
bot.command('streak',  handleStreak);
bot.command('target',  handleTarget);
bot.command('remind',  handleRemind);
bot.command('menu',    handleMenu);
bot.command('catat',   handleCatat);
bot.command('input',   handleInput);
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

// ─── HTTP SERVER (WAJIB UNTUK RENDER) ────────────────────────
// Render butuh HTTP server yang aktif — kalau gak ada, service dianggap crash
// Server ini juga yang di-ping UptimeRobot biar bot gak sleep
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            bot:    process.env.BOT_NAME || 'NutriBot',
            uptime: Math.round(process.uptime()) + 's',
            ts:     new Date().toISOString()
        }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

// ─── START BOT ───────────────────────────────────────────────
bot.launch()
    .then(() => {
        console.log(`\n✅ ${process.env.BOT_NAME || 'NutriBot'} aktif!`);
        console.log(`⏰ Started: ${new Date().toLocaleString('id-ID')}\n`);
        initReminder(bot);
    })
    .catch(err => {
        console.error('❌ Gagal start:', err.message);
        process.exit(1);
    });

process.once('SIGINT',  () => { bot.stop('SIGINT');  server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });