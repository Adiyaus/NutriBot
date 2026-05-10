// ============================================================
// api/cron-reminder.js
// Dipanggil oleh Vercel Cron setiap menit (lihat vercel.json)
// Gantikan node-cron yang gak bisa jalan di serverless
// ============================================================

const { Telegraf } = require('telegraf');
const db = require('../src/services/database');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

module.exports = async (req, res) => {
    // Keamanan: pastikan request dari Vercel Cron (ada header khusus)
    // atau dari CRON_SECRET yang kamu set di env
    const authHeader = req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Hitung waktu WIB sekarang
        const now        = new Date();
        const wibMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 7 * 60) % (24 * 60);
        const hours      = String(Math.floor(wibMinutes / 60)).padStart(2, '0');
        const minutes    = String(wibMinutes % 60).padStart(2, '0');
        const timeNow    = `${hours}:${minutes}`;

        // ── Auto-reset memory tengah malam WIB (00:00 = 17:00 UTC) ──
        if (hours === '00' && minutes === '00') {
            try {
                const { resetDailyMemory } = require('../src/handlers/messageHandler');
                resetDailyMemory();
                console.log('[MidnightReset] 00:00 WIB — memory reset done ✅');
            } catch (err) {
                console.error('[MidnightReset] Error:', err.message);
            }
        }

        // ── Kirim reminder ke user yang jadwalnya cocok ──────────────
        const users = await db.getUsersWithReminder(timeNow);

        if (users.length === 0) {
            return res.status(200).json({ ok: true, time: timeNow, sent: 0 });
        }

        console.log(`[Reminder] Jam ${timeNow} WIB — ${users.length} user`);

        let sent = 0;
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
                sent++;
            } catch (sendErr) {
                console.error(`[Reminder] Gagal kirim ke ${user.telegram_id}:`, sendErr.message);
            }
        }

        res.status(200).json({ ok: true, time: timeNow, sent });

    } catch (err) {
        console.error('[Reminder] Cron error:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
};
