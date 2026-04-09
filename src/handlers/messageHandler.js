// ============================================================
// src/handlers/messageHandler.js
// Update: tambah /reset, /adjust, persistent user data
// ============================================================

const db     = require('../services/database');
const gemini = require('../services/gemini');
const calc   = require('../utils/calculator');

// In-memory store buat nyimpen last log ID per user
// Dipake buat fitur /adjust — tau log mana yang mau dikoreksi
const lastLogIdMap = new Map(); // key: telegramId, value: logId

// In-memory store buat tau user lagi di mode adjust atau engga
const adjustModeMap = new Map(); // key: telegramId, value: logId

async function reply(ctx, text, extra = {}) {
    return ctx.reply(text, { parse_mode: 'Markdown', ...extra });
}

// ─── COMMAND HANDLERS ────────────────────────────────────────

/**
 * /start atau /mulai
 * PENTING: kalau user udah registered, langsung sambut — jangan reset data!
 */
async function handleStart(ctx) {
    const tgId   = ctx.from.id;
    const tgName = ctx.from.first_name || 'bestie';

    // Cek dulu apakah user udah pernah daftar
    const existingUser = await db.getUser(tgId);

    // Kalau udah registered, sambut langsung tanpa reset
    if (existingUser?.is_registered) {
        await reply(ctx,
            `Heyy ${existingUser.name}! 👋 Welcome back!\n\n` +
            `Target kalori lo: *${Math.round(existingUser.daily_calorie_goal)} kkal/hari*\n\n` +
            `Kirim *foto makanan* buat mulai log, atau ketik /help buat list command! 😊`
        );
        return;
    }

    // Kalau belum, mulai registrasi
    await db.upsertUser(tgId, {
        username: ctx.from.username || null,
        registration_step: 'ask_name',
        is_registered: false
    });

    await reply(ctx,
        `Heyy ${tgName}! 👋 Welcome to *NutriBot!*\n\n` +
        `Gua bakal bantu lo track kalori & nutrisi harian pakai AI. ✨\n\n` +
        `First things first — *nama panggilan lo siapa?*`
    );
}

async function handleHelp(ctx) {
    await reply(ctx,
        `🤖 *NutriBot — Command List:*\n\n` +
        `/mulai — daftar (kalau belum) atau lihat status\n` +
        `/status — cek sisa kalori hari ini\n` +
        `/laporan — progress 7 hari terakhir\n` +
        `/profil — lihat & update data profil\n` +
        `/reset — hapus semua log kalori hari ini\n` +
        `/adjust — koreksi hasil analisis terakhir\n` +
        `/help — tampilkan menu ini\n\n` +
        `📸 *Kirim foto makanan* → auto analisis nutrisi!\n\n` +
        `_Powered by Gemini 2.5 Flash_ 🤖`
    );
}

async function handleStatus(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar dulu nih! 😅\nKetik /mulai buat start registrasi ya!`);
        return;
    }

    const summary = await db.getDailySummary(tgId);
    await reply(ctx, buildStatusMessage(summary, user.daily_calorie_goal));
}

async function handleLaporan(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const logs = await db.getWeeklyLogs(tgId);

    if (!logs || logs.length === 0) {
        await reply(ctx, `📭 Belum ada data minggu ini. Yuk mulai log makanan lo! 💪`);
        return;
    }

    const totalCal   = logs.reduce((sum, l) => sum + Number(l.calories), 0);
    const daysLogged = [...new Set(logs.map(l => l.log_date))].length;
    const avgCal     = Math.round(totalCal / daysLogged);
    const diff       = avgCal - user.daily_calorie_goal;

    await reply(ctx,
        `📈 *Laporan Mingguan Lo:*\n\n` +
        `📅 Hari ke-log: *${daysLogged}/7 hari*\n` +
        `🔥 Total kalori: *${Math.round(totalCal)} kkal*\n` +
        `📊 Rata-rata/hari: *${avgCal} kkal*\n` +
        `🎯 Target/hari: *${Math.round(user.daily_calorie_goal)} kkal*\n\n` +
        `${diff > 0
            ? `⚠️ Rata-rata lo *over ${Math.round(diff)} kkal/hari*`
            : `✅ Rata-rata lo *under ${Math.abs(Math.round(diff))} kkal/hari* — good job!`
        }\n\n_Keep it up! Consistency is key 🔑_`
    );
}

async function handleProfil(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    await reply(ctx,
        `👤 *Profil Lo:*\n\n` +
        `Nama: *${user.name || '-'}*\n` +
        `Umur: *${user.age} tahun*\n` +
        `Gender: *${user.gender}*\n` +
        `Tinggi: *${user.height_cm} cm*\n` +
        `Berat: *${user.weight_kg} kg*\n` +
        `BMR: *${Math.round(user.bmr)} kkal/hari*\n` +
        `TDEE: *${Math.round(user.tdee)} kkal/hari*\n` +
        `Target: *${Math.round(user.daily_calorie_goal)} kkal/hari*\n\n` +
        `_Mau update profil? Ketik /mulai lagi_`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✏️ Update Profil', callback_data: 'update_profile' }
                ]]
            }
        }
    );
}

/**
 * /reset — hapus semua log kalori hari ini
 * Minta konfirmasi dulu sebelum hapus biar gak salah pencet
 */
async function handleReset(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const summary = await db.getDailySummary(tgId);

    // Kalau emang belum ada log hari ini
    if (!summary.meal_count || summary.meal_count === 0) {
        await reply(ctx, `📭 Belum ada log makanan hari ini, jadi gak ada yang perlu di-reset!`);
        return;
    }

    // Minta konfirmasi dulu pakai inline keyboard
    await reply(ctx,
        `⚠️ *Yakin mau reset log hari ini?*\n\n` +
        `Yang akan dihapus:\n` +
        `• ${summary.meal_count}x log makanan\n` +
        `• Total ${Math.round(summary.total_calories)} kkal tercatat\n\n` +
        `_Aksi ini gak bisa di-undo!_`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Ya, Reset!',  callback_data: 'confirm_reset' },
                    { text: '❌ Batalin',     callback_data: 'cancel_reset'  }
                ]]
            }
        }
    );
}

/**
 * /adjust — koreksi deskripsi hasil analisis terakhir
 * User bisa bilang "itu bukan nasi goreng tapi nasi putih biasa"
 */
async function handleAdjust(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const lastLogId = lastLogIdMap.get(tgId); // ambil ID log terakhir dari memory

    if (!lastLogId) {
        await reply(ctx,
            `Hmm, gua gak nemuin analisis terakhir lo. 🤔\n\n` +
            `Kirim foto makanan dulu, baru bisa di-adjust ya!`
        );
        return;
    }

    // Set user ke mode adjust — pesan teks berikutnya akan diproses sebagai koreksi
    adjustModeMap.set(tgId, lastLogId);

    await reply(ctx,
        `✏️ *Mode Koreksi Aktif*\n\n` +
        `Ketik deskripsi makanan yang bener ya!\n\n` +
        `_Contoh: "nasi putih 1 porsi, ayam goreng 1 potong, tempe goreng 2 potong"_\n\n` +
        `Atau ketik /batal buat cancel`
    );
}

// ─── TEXT HANDLER (State Machine) ────────────────────────────

async function handleText(ctx) {
    const tgId = ctx.from.id;
    const body = ctx.message.text?.trim() || '';
    const user = await db.getUser(tgId);

    // ── Handle mode adjust ──────────────────────────────────
    // Cek ini PERTAMA sebelum apapun
    if (adjustModeMap.has(tgId)) {
        await handleAdjustInput(ctx, tgId, body);
        return;
    }

    // ── Handle /batal command ───────────────────────────────
    if (body.toLowerCase() === '/batal' || body.toLowerCase() === 'batal') {
        adjustModeMap.delete(tgId);
        await reply(ctx, `Oke, koreksi dibatalin! 👌`);
        return;
    }

    if (!user) {
        await reply(ctx,
            `Heyy! 👋 Gua *NutriBot*, nutrition tracker lo!\n\n` +
            `Ketik /mulai buat daftar dan mulai track kalori lo. 🚀`
        );
        return;
    }

    if (user.is_registered && user.registration_step === 'complete') {
        await reply(ctx,
            `Hai ${user.name}! 👋\n\n` +
            `Kirim *foto makanan* buat log nutrisi, atau ketik /help buat list command! 😊`
        );
        return;
    }

    await processRegistrationStep(ctx, tgId, user, body);
}

/**
 * Handle input teks saat user di mode /adjust
 */
async function handleAdjustInput(ctx, tgId, newDescription) {
    const logId = adjustModeMap.get(tgId);

    if (!newDescription || newDescription.length < 3) {
        await reply(ctx, `Deskripsinya terlalu pendek. Coba tulis lebih detail ya!`);
        return;
    }

    try {
        await db.updateFoodLogDescription(logId, newDescription);
        adjustModeMap.delete(tgId); // keluar dari mode adjust

        await reply(ctx,
            `✅ *Deskripsi berhasil diupdate!*\n\n` +
            `🍽️ *${newDescription}*\n\n` +
            `_Note: kalori & nutrisi tetap dari estimasi awal Gemini ya. ` +
            `Kalau mau recalculate, hapus log ini dan kirim foto ulang._`
        );
    } catch (err) {
        await reply(ctx, `😵 Gagal update deskripsi. Coba lagi ya!`);
    }
}

// ─── REGISTRATION FLOW ────────────────────────────────────────

async function processRegistrationStep(ctx, tgId, user, body) {
    const step = user?.registration_step || 'idle';

    switch (step) {
        case 'ask_name': {
            if (body.length < 2 || body.length > 50) {
                await reply(ctx, `Nama harus 2-50 karakter ya. Coba lagi! 😊`);
                return;
            }
            await db.upsertUser(tgId, { name: body, registration_step: 'ask_age' });
            await reply(ctx, `Nice, *${body}*! 😄\n\nSekarang, *umur lo berapa?*\n_(ketik angkanya aja, contoh: 25)_`);
            break;
        }

        case 'ask_age': {
            const age = parseInt(body);
            if (isNaN(age) || age < 10 || age > 120) {
                await reply(ctx, `Umur harus angka antara 10-120 ya. Coba lagi!`);
                return;
            }
            await db.upsertUser(tgId, { age, registration_step: 'ask_gender' });
            await ctx.reply(`Got it! *Gender lo?*`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '👨 Pria',   callback_data: 'gender_pria'   },
                        { text: '👩 Wanita', callback_data: 'gender_wanita' }
                    ]]
                }
            });
            break;
        }

        case 'ask_height': {
            const height = parseFloat(body);
            if (isNaN(height) || height < 100 || height > 250) {
                await reply(ctx, `Tinggi badan harus antara 100-250 cm. Coba lagi!`);
                return;
            }
            await db.upsertUser(tgId, { height_cm: height, registration_step: 'ask_weight' });
            await reply(ctx, `Oke! *Berat badan lo sekarang berapa kg?*\n_(contoh: 75)_`);
            break;
        }

        case 'ask_weight': {
            const weight = parseFloat(body);
            if (isNaN(weight) || weight < 20 || weight > 500) {
                await reply(ctx, `Berat badan harus antara 20-500 kg. Coba lagi!`);
                return;
            }
            await db.upsertUser(tgId, { weight_kg: weight, registration_step: 'ask_activity' });
            await ctx.reply(`Almost done! 🎯 *Level aktivitas fisik lo?*`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🛋️ Santai banget',              callback_data: 'activity_sedentary'   }],
                        [{ text: '🚶 Gerak dikit (1-3x/minggu)',   callback_data: 'activity_light'       }],
                        [{ text: '🏃 Lumayan aktif (3-5x/minggu)', callback_data: 'activity_moderate'    }],
                        [{ text: '💪 Aktif banget (6-7x/minggu)',  callback_data: 'activity_active'      }],
                        [{ text: '🏋️ Super aktif / Atlet',        callback_data: 'activity_very_active' }]
                    ]
                }
            });
            break;
        }

        default:
            await db.updateRegistrationStep(tgId, 'idle');
            await reply(ctx, `Hmm ada yang error nih. Ketik /mulai lagi ya!`);
    }
}

// ─── CALLBACK QUERY HANDLER ───────────────────────────────────

async function handleCallbackQuery(ctx) {
    const tgId = ctx.from.id;
    const data = ctx.callbackQuery.data;

    await ctx.answerCbQuery();

    // ── Konfirmasi Reset ────────────────────────────────────
    if (data === 'confirm_reset') {
        try {
            const deleted = await db.deleteTodayLogs(tgId);
            lastLogIdMap.delete(tgId);  // hapus juga last log ID dari memory
            adjustModeMap.delete(tgId); // pastiin mode adjust juga di-clear

            await ctx.editMessageText(
                `✅ *Reset berhasil!*\n\n` +
                `${deleted} log makanan hari ini udah dihapus.\n` +
                `Kalori lo balik ke *0 kkal*. Fresh start! 💪`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            await ctx.editMessageText(`❌ Gagal reset. Coba lagi ya!`);
        }
        return;
    }

    if (data === 'cancel_reset') {
        await ctx.editMessageText(`Oke, log hari ini aman! 👌`);
        return;
    }

    // ── Update Profil ───────────────────────────────────────
    if (data === 'update_profile') {
        await db.upsertUser(tgId, { registration_step: 'ask_name', is_registered: false });
        await ctx.editMessageText(`Oke, let's update profil lo! 📝`);
        await reply(ctx, `*Nama panggilan lo siapa?*\n_(ketik nama baru, atau nama yang sama)_`);
        return;
    }

    // ── Pilihan Gender ──────────────────────────────────────
    if (data.startsWith('gender_')) {
        const gender = data.replace('gender_', '');
        await db.upsertUser(tgId, { gender, registration_step: 'ask_height' });
        await ctx.editMessageText(
            `Gender: *${gender === 'pria' ? '👨 Pria' : '👩 Wanita'}* ✅`,
            { parse_mode: 'Markdown' }
        );
        await reply(ctx, `*Tinggi badan lo berapa cm?*\n_(contoh: 170)_`);
        return;
    }

    // ── Pilihan Aktivitas ───────────────────────────────────
    if (data.startsWith('activity_')) {
        const activityLevel = data.replace('activity_', '');
        const user = await db.getUser(tgId);

        const bmr       = calc.calculateBMR(user.weight_kg, user.height_cm, user.age, user.gender);
        const tdee      = calc.calculateTDEE(bmr, activityLevel);
        const dailyGoal = calc.calculateDailyGoal(tdee);

        await db.upsertUser(tgId, {
            activity_level:     activityLevel,
            bmr, tdee,
            daily_calorie_goal: dailyGoal,
            is_registered:      true,
            registration_step:  'complete'
        });

        await ctx.editMessageText(
            `Aktivitas: *${calc.ACTIVITY_LABELS[activityLevel]}* ✅`,
            { parse_mode: 'Markdown' }
        );

        await reply(ctx,
            `Yeaay! Profil *tersimpan*, ${user.name}! 🎉\n\n` +
            calc.formatCalorieReport(bmr, tdee, dailyGoal, activityLevel) +
            `\n\n💡 *Cara pakainya:*\n` +
            `• Kirim *foto makanan* → gua analisis nutrisinya\n` +
            `• /status → cek sisa kalori hari ini\n` +
            `• /reset → hapus log hari ini\n` +
            `• /adjust → koreksi analisis terakhir\n\n` +
            `_Let's get healthy! 💪_`
        );
    }
}

// ─── PHOTO HANDLER ───────────────────────────────────────────

async function handlePhoto(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! 😅 Ketik /mulai dulu ya.`);
        return;
    }

    // Kalau lagi di mode adjust, cancel dulu
    if (adjustModeMap.has(tgId)) {
        adjustModeMap.delete(tgId);
    }

    const loadingMsg = await reply(ctx,
        `Sebentar ya... 🔍\n_Gemini lagi analisis makanannya..._`
    );

    try {
        const photos    = ctx.message.photo;
        const bestPhoto = photos[photos.length - 1];

        const fileInfo    = await ctx.telegram.getFile(bestPhoto.file_id);
        const fileUrl     = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
        const imageBuffer = await gemini.downloadImage(fileUrl);
        const result      = await gemini.analyzeFoodImage(imageBuffer, 'image/jpeg');

        if (!result.is_food) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, loadingMsg.message_id, null,
                `Hmm, kayaknya itu bukan foto makanan deh... 🤔\n` +
                `Coba kirim foto yang ada makanannya ya!\n\n` +
                `_Tips: pastiin pencahayaan cukup & makanan keliatan jelas_ 📸`
            );
            return;
        }

        // Simpan ke DB dan simpan ID-nya buat fitur /adjust
        const savedLog = await db.insertFoodLog(tgId, {
            food_description: result.food_description,
            calories:         result.calories,
            protein_g:        result.protein_g,
            carbs_g:          result.carbs_g,
            fat_g:            result.fat_g,
            gemini_raw:       result.gemini_raw
        });

        // Simpan last log ID ke memory (dipake kalau user /adjust)
        lastLogIdMap.set(tgId, savedLog.id);

        const summary   = await db.getDailySummary(tgId);
        const remaining = user.daily_calorie_goal - (summary.total_calories || 0);

        const statusEmoji   = remaining > 0 ? '✅' : '🚨';
        const remainingText = remaining > 0
            ? `Sisa: *${Math.round(remaining)} kkal* buat hari ini`
            : `⚠️ Lo udah *over ${Math.abs(Math.round(remaining))} kkal* dari target!`;

        const resultText =
            `${statusEmoji} *Hasil Analisis Makanan:*\n\n` +
            `🍽️ *${result.food_description}*\n\n` +
            `🔥 Kalori: *${result.calories} kkal*\n` +
            `💪 Protein: *${result.protein_g}g*\n` +
            `🍚 Karbo: *${result.carbs_g}g*\n` +
            `🥑 Lemak: *${result.fat_g}g*\n` +
            `${result.confidence === 'low' ? '\n⚠️ _Confidence rendah, coba foto lebih jelas_\n' : ''}` +
            `${result.notes ? `\n📝 _${result.notes}_\n` : ''}` +
            `\n_Estimasi by Gemini 2.5 Flash_ 🤖\n\n` +
            `━━━━━━━━━━━━━━\n` +
            `📊 *Progress Hari Ini (${Math.round(user.daily_calorie_goal)} kkal target):*\n` +
            `${remainingText}\n\n` +
            `_Salah analisis? Ketik /adjust untuk koreksi_ ✏️`;

        await ctx.telegram.editMessageText(
            ctx.chat.id, loadingMsg.message_id, null,
            resultText,
            { parse_mode: 'Markdown' }
        );

    } catch (err) {
        console.error(`[PhotoHandler] Error for ${tgId}:`, err.message);

        const errorMessages = {
            'RATE_LIMIT':   `⏳ Gemini lagi overload. Tunggu ~1 menit terus coba lagi ya!`,
            'SAFETY_BLOCK': `🚫 Gambar gak bisa diproses. Kirim foto makanan biasa aja ya!`,
            'GEMINI_ERROR': `😵 Ada error di analisis gambar. Coba kirim ulang!`,
        };

        const errMsg = errorMessages[err.message] || `❌ Something went wrong. Coba lagi ya!`;
        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, errMsg)
            .catch(() => reply(ctx, errMsg));
    }
}

// ─── HELPERS ─────────────────────────────────────────────────

function buildProgressBar(pct) {
    const filled = Math.round(Math.min(pct, 100) / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function buildStatusMessage(summary, dailyGoal) {
    const consumed   = Math.round(summary.total_calories || 0);
    const remaining  = Math.round(dailyGoal - consumed);
    const percentage = Math.min(100, Math.round((consumed / dailyGoal) * 100));

    return (
        `📊 *Status Kalori Hari Ini:*\n\n` +
        `${buildProgressBar(percentage)} ${percentage}%\n\n` +
        `🔥 Terpakai: *${consumed} / ${Math.round(dailyGoal)} kkal*\n` +
        `📉 Sisa: *${remaining > 0 ? remaining : 0} kkal*\n\n` +
        `💪 Protein: ${(summary.total_protein || 0).toFixed(1)}g\n` +
        `🍚 Karbo: ${(summary.total_carbs || 0).toFixed(1)}g\n` +
        `🥑 Lemak: ${(summary.total_fat || 0).toFixed(1)}g\n\n` +
        `🍽️ Udah makan ${summary.meal_count || 0}x hari ini\n\n` +
        `${remaining < 0 ? '⚠️ _Lo over budget kalori hari ini!_' : '✅ _Keep going, lo on track!_'}`
    );
}

module.exports = {
    handleStart, handleHelp, handleStatus, handleLaporan,
    handleProfil, handleReset, handleAdjust,
    handleText, handleCallbackQuery, handlePhoto
};