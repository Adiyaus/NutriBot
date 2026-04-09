require('dotenv').config();

const { Telegraf }     = require('telegraf');
const { initReminder } = require('./services/reminder');

const {
    handleStart, handleHelp, handleStatus, handleLaporan,
    handleProfil, handleReset, handleAdjust,
    handleStreak, handleTarget, handleRemind,
    handleMenu, handleCatat, handleTanya,
    handleText, handleCallbackQuery, handlePhoto
} = require('./handlers/messageHandler');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.start(handleStart);
bot.command('mulai',   handleStart);
bot.command('help',    handleHelp);
bot.command('status',  handleStatus);
bot.command('laporan', handleLaporan);
bot.command('profil',  handleProfil);
bot.command('reset',   handleReset);
bot.command('adjust',  handleAdjust);
bot.command('streak',  handleStreak);
bot.command('target',  handleTarget);
bot.command('remind',  handleRemind);
bot.command('menu',    handleMenu);
bot.command('catat',   handleCatat);
bot.command('tanya',   handleTanya);

bot.on('photo',          handlePhoto);
bot.on('callback_query', handleCallbackQuery);
bot.on('text',           handleText);

bot.catch((err, ctx) => {
    console.error(`[Bot] Error:`, err.message);
    ctx.reply(`😵 Ada error nih. Coba lagi ya!`).catch(() => {});
});

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

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));