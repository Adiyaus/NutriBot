// ============================================================
// src/services/reminder.js
// Cron job reminder harian — weekly coaching dihapus (hemat quota)
// ============================================================

const cron = require('node-cron');
const db   = require('./database');

function initReminder(bot) {

    // ── Daily reminder — cek setiap menit ────────────────────
    cron.schedule('* * * * *', async () => {
        try {
            const now        = new Date();
            const wibMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 7 * 60) % (24 * 60);
            const hours      = String(Math.floor(wibMinutes / 60)).padStart(2, '0');
            const minutes    = String(wibMinutes % 60).padStart(2, '0');
            const timeNow    = `${hours}:${minutes}`;

            const users = await db.getUsersWithReminder(timeNow);
            if (users.length === 0) return;

            console.log(`[Reminder] Jam ${timeNow} WIB — ${users.length} user`);

            for (const user of users) {
                try {
                    const summary   = await db.getDailySummary(user.telegram_id);
                    const consumed  = Math.round(summary.total_calories || 0);
                    const remaining = Math.round((user.daily_calorie_goal || 0) - consumed);

                    let reminderText;
                    if (consumed === 0) {
                        reminderText =
                            `⏰ *Hey ${user.name}!*\n\n` +
                            `Lo belum log makanan apapun hari ini! 😅\n` +
                            `Kirim foto atau ketik /catat sekarang ya! 💪`;
                    } else if (remaining > 0) {
                        reminderText =
                            `⏰ *Reminder, ${user.name}!*\n\n` +
                            `Sisa kalori: *${remaining} kkal*\n` +
                            `Udah makan ${summary.meal_count}x — keep it up! 😊\n\n` +
                            `Kirim foto kalau udah makan ya! 📸`;
                    } else {
                        reminderText =
                            `⏰ *Reminder, ${user.name}!*\n\n` +
                            `Lo udah *over ${Math.abs(remaining)} kkal* hari ini.\n` +
                            `Gak apa-apa, besok bisa lebih baik! 💪`;
                    }

                    await bot.telegram.sendMessage(user.telegram_id, reminderText, {
                        parse_mode: 'Markdown'
                    });

                } catch (sendErr) {
                    console.error(`[Reminder] Gagal kirim ke ${user.telegram_id}:`, sendErr.message);
                }
            }
        } catch (err) {
            console.error('[Reminder] Cron error:', err.message);
        }
    });

    console.log('⏰ Reminder cron aktif');
}

module.exports = { initReminder };