// ============================================================
// src/services/reminder.js
// Update: tambah weekly coaching setiap Senin pagi
// ============================================================

const cron   = require('node-cron');
const db     = require('./database');
const gemini = require('./gemini');

function initReminder(bot) {

    // ── Daily reminder — cek setiap menit ────────────────────
    cron.schedule('0 * * * *', async () => {
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

    // ── Weekly coaching — setiap Senin jam 07:00 WIB ─────────
    // WIB = UTC+7 → 07:00 WIB = 00:00 UTC
    // Cron format: menit jam hari-bulan bulan hari-minggu (1=Senin)
    cron.schedule('0 0 * * 1', async () => {
        try {
            console.log('[WeeklyCoaching] Senin pagi — kirim weekly insight...');

            // Ambil semua user yang sudah registered
            const { data: users, error } = await require('@supabase/supabase-js')
                .createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
                .from('users')
                .select('*')
                .eq('is_registered', true);

            if (error || !users?.length) return;

            for (const user of users) {
                try {
                    const logs       = await db.getWeeklyLogs(user.telegram_id);
                    const daysLogged = [...new Set(logs.map(l => l.log_date))].length;

                    // Skip kalau sama sekali gak ada log minggu ini
                    if (daysLogged === 0) continue;

                    const totalCal   = logs.reduce((s, l) => s + Number(l.calories), 0);
                    const avgCalories = Math.round(totalCal / daysLogged);

                    // Generate weekly coaching dari Gemini
                    const coaching = await gemini.generateWeeklyCoaching(
                        user, logs, avgCalories, daysLogged
                    );

                    if (!coaching) continue;

                    // Hitung streak buat ditampilin juga
                    const streak = await db.getStreak(user.telegram_id);

                    await bot.telegram.sendMessage(user.telegram_id,
                        `📅 *Weekly Check-in, ${user.name}!*\n\n` +
                        `*Minggu kemarin:*\n` +
                        `• Log ${daysLogged}/7 hari\n` +
                        `• Rata-rata ${avgCalories} kkal/hari\n` +
                        `• Streak sekarang: ${streak} hari 🔥\n\n` +
                        `💬 *Coach says:*\n\n${coaching}`,
                        { parse_mode: 'Markdown' }
                    );

                    // Jeda 500ms antar user biar gak spam Telegram API
                    await new Promise(res => setTimeout(res, 500));

                } catch (userErr) {
                    console.error(`[WeeklyCoaching] Error untuk ${user.telegram_id}:`, userErr.message);
                }
            }

            console.log('[WeeklyCoaching] Done!');

        } catch (err) {
            console.error('[WeeklyCoaching] Cron error:', err.message);
        }
    });

    console.log('⏰ Reminder + Weekly Coaching cron aktif');
}

module.exports = { initReminder };