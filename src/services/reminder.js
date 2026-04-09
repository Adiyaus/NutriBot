// ============================================================
// src/services/reminder.js
// Cron job yang jalan di background — kirim reminder ke user
// sesuai jadwal yang mereka set via /remind
// ============================================================

const cron = require('node-cron');
const db   = require('./database');

/**
 * Inisialisasi cron job reminder
 * Dipanggil sekali dari index.js waktu bot start
 *
 * @param {object} bot - Telegraf bot instance
 */
function initReminder(bot) {
    // Jadwal: jalanin setiap menit ('* * * * *')
    // Format cron: detik menit jam hari-bulan bulan hari-minggu
    cron.schedule('* * * * *', async () => {
        try {
            // Ambil jam sekarang dalam format HH:MM (WIB = UTC+7)
            const now = new Date();

            // Konversi ke WIB (UTC+7) — penting biar reminder tepat waktu!
            const wibOffset  = 7 * 60;                          // 7 jam dalam menit
            const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
            const wibMinutes = (utcMinutes + wibOffset) % (24 * 60); // wrap di tengah malam

            const hours   = String(Math.floor(wibMinutes / 60)).padStart(2, '0');
            const minutes = String(wibMinutes % 60).padStart(2, '0');
            const timeNow = `${hours}:${minutes}`; // format 'HH:MM'

            // Cari user yang reminder-nya di jam ini
            const users = await db.getUsersWithReminder(timeNow);

            if (users.length === 0) return; // gak ada yang perlu diremind sekarang

            console.log(`[Reminder] Jam ${timeNow} WIB — ngirim ke ${users.length} user`);

            // Kirim reminder ke masing-masing user
            for (const user of users) {
                try {
                    // Ambil summary hari ini buat kasih konteks
                    const summary   = await db.getDailySummary(user.telegram_id);
                    const consumed  = Math.round(summary.total_calories || 0);
                    const remaining = Math.round((user.daily_calorie_goal || 0) - consumed);

                    let reminderText;

                    if (consumed === 0) {
                        // Belum log sama sekali hari ini
                        reminderText =
                            `⏰ *Hey ${user.name}!*\n\n` +
                            `Lo belum log makanan apapun hari ini nih! 😅\n` +
                            `Kirim foto makanan lo sekarang ya — jangan skip! 💪`;
                    } else if (remaining > 0) {
                        // Udah log tapi masih ada sisa kalori
                        reminderText =
                            `⏰ *Reminder Makan, ${user.name}!*\n\n` +
                            `Sisa kalori lo hari ini: *${remaining} kkal*\n` +
                            `Udah makan ${summary.meal_count}x — keep it up! 😊\n\n` +
                            `Kirim foto kalau udah makan ya! 📸`;
                    } else {
                        // Udah over kalori
                        reminderText =
                            `⏰ *Reminder, ${user.name}!*\n\n` +
                            `FYI lo udah *over ${Math.abs(remaining)} kkal* hari ini.\n` +
                            `Gak apa-apa, besok bisa lebih baik! 💪\n\n` +
                            `_Tetap semangat ya!_ 🌟`;
                    }

                    await bot.telegram.sendMessage(user.telegram_id, reminderText, {
                        parse_mode: 'Markdown'
                    });

                } catch (sendErr) {
                    // Kalau gagal kirim ke 1 user, jangan stop — lanjut ke user berikutnya
                    console.error(`[Reminder] Gagal kirim ke ${user.telegram_id}:`, sendErr.message);
                }
            }

        } catch (err) {
            console.error('[Reminder] Cron error:', err.message);
        }
    });

    console.log('⏰ Reminder cron job aktif');
}

module.exports = { initReminder };