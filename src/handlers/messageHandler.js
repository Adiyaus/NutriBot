// ============================================================
// src/handlers/messageHandler.js
// Update: tambah fitur saved menus (/menu, simpan, pilih, hapus)
// ============================================================

const db     = require('../services/database');
const gemini = require('../services/gemini');
const calc   = require('../utils/calculator');

const lastLogIdMap    = new Map(); // last log ID per user (buat /adjust)
const lastResultMap   = new Map(); // last Gemini result per user (buat simpan menu)
const adjustModeMap   = new Map(); // user lagi di mode adjust
const saveMenuModeMap = new Map(); // user lagi di mode input nama menu

async function reply(ctx, text, extra = {}) {
    return ctx.reply(text, { parse_mode: 'Markdown', ...extra });
}

// ─── COMMAND HANDLERS ────────────────────────────────────────

async function handleStart(ctx) {
    const tgId   = ctx.from.id;
    const tgName = ctx.from.first_name || 'bestie';

    const existingUser = await db.getUser(tgId);

    if (existingUser?.is_registered) {
        await reply(ctx,
            `Heyy ${existingUser.name}! 👋 Welcome back!\n\n` +
            `Target kalori lo: *${Math.round(existingUser.daily_calorie_goal)} kkal/hari*\n\n` +
            `Kirim *foto makanan* buat mulai log, atau ketik /help! 😊`
        );
        return;
    }

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
        `*/mulai* — daftar atau lihat status\n` +
        `*/status* — cek sisa kalori hari ini\n` +
        `*/laporan* — progress 7 hari terakhir\n` +
        `*/streak* — cek konsistensi log harian\n` +
        `*/target [kg]* — set target berat badan\n` +
        `*/remind [HH:MM]* — set reminder harian\n` +
        `*/menu* — lihat & pilih menu tersimpan\n` +
        `*/catat [makanan]* — log makanan tanpa foto\n` +
        `*/profil* — lihat & update data profil\n` +
        `*/reset* — hapus semua log hari ini\n` +
        `*/adjust* — koreksi hasil analisis terakhir\n` +
        `*/help* — tampilkan menu ini\n\n` +
        `📸 *Kirim foto makanan* → auto analisis + opsi simpan ke menu!\n\n` +
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
        `Target kalori: *${Math.round(user.daily_calorie_goal)} kkal/hari*\n` +
        `Target berat: *${user.target_weight ? user.target_weight + ' kg' : 'belum diset'}*\n` +
        `Reminder: *${user.reminder_time ? user.reminder_time + ' WIB' : 'off'}*\n\n` +
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

async function handleReset(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const summary = await db.getDailySummary(tgId);

    if (!summary.meal_count || summary.meal_count === 0) {
        await reply(ctx, `📭 Belum ada log makanan hari ini!`);
        return;
    }

    await reply(ctx,
        `⚠️ *Yakin mau reset log hari ini?*\n\n` +
        `• ${summary.meal_count}x log makanan\n` +
        `• Total ${Math.round(summary.total_calories)} kkal\n\n` +
        `_Aksi ini gak bisa di-undo!_`,
        {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Ya, Reset!', callback_data: 'confirm_reset' },
                    { text: '❌ Batalin',    callback_data: 'cancel_reset'  }
                ]]
            }
        }
    );
}

async function handleAdjust(ctx) {
    const tgId      = ctx.from.id;
    const user      = await db.getUser(tgId);
    const lastLogId = lastLogIdMap.get(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    if (!lastLogId) {
        await reply(ctx, `Belum ada analisis terakhir nih. Kirim foto dulu ya! 📸`);
        return;
    }

    adjustModeMap.set(tgId, lastLogId);
    await reply(ctx,
        `✏️ *Mode Koreksi Aktif*\n\n` +
        `Ketik deskripsi makanan yang bener:\n\n` +
        `_Contoh: "nasi putih 1 porsi, ayam goreng 1 potong"_\n\n` +
        `Atau /batal buat cancel`
    );
}

async function handleStreak(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const streak = await db.getStreak(tgId);

    let streakEmoji, streakMsg;
    if (streak === 0)       { streakEmoji = '😴'; streakMsg = `Belum ada streak. Yuk mulai hari ini! 💪`; }
    else if (streak < 3)    { streakEmoji = '🔥'; streakMsg = `Good start! Pertahanin terus!`; }
    else if (streak < 7)    { streakEmoji = '🔥🔥'; streakMsg = `Mantap! Lo lagi on fire!`; }
    else if (streak < 14)   { streakEmoji = '🔥🔥🔥'; streakMsg = `Seminggu lebih — lo serius nih! Respect! 🫡`; }
    else if (streak < 30)   { streakEmoji = '⚡'; streakMsg = `2 minggu lebih?! Beast mode! 💪`; }
    else                    { streakEmoji = '👑'; streakMsg = `Lo udah level dewa konsistensi. Salute! 🫡`; }

    const todaySummary = await db.getDailySummary(tgId);
    const loggedToday  = todaySummary.meal_count > 0;

    await reply(ctx,
        `${streakEmoji} *Streak Lo:*\n\n` +
        `🗓️ *${streak} hari berturut-turut* log makanan!\n\n` +
        `${streakMsg}\n\n` +
        `${loggedToday
            ? `✅ Hari ini udah ke-log — streak aman!`
            : `⚠️ Hari ini belum ada log — kirim foto buat jaga streak!`
        }`
    );
}

async function handleTarget(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const args         = ctx.message.text.split(' ');
    const targetWeight = parseFloat(args[1]);

    if (!args[1]) {
        if (user.target_weight) {
            const remaining  = user.weight_kg - user.target_weight;
            const weeklyLoss = (parseInt(process.env.CALORIE_DEFICIT) || 500) * 7 / 7700;
            const weeksLeft  = Math.ceil(remaining / weeklyLoss);
            await reply(ctx,
                `🎯 *Target Berat Lo:*\n\n` +
                `Berat sekarang: *${user.weight_kg} kg*\n` +
                `Target: *${user.target_weight} kg*\n` +
                `Sisa: *${remaining.toFixed(1)} kg* lagi\n` +
                `Estimasi: *~${weeksLeft} minggu lagi*\n\n` +
                `_Ganti target? /target [angka baru]_`
            );
        } else {
            await reply(ctx, `Belum ada target!\n\nCaranya: \`/target 80\``);
        }
        return;
    }

    if (isNaN(targetWeight) || targetWeight < 30 || targetWeight > 300) {
        await reply(ctx, `Target harus angka antara 30-300 kg ya!`);
        return;
    }

    if (targetWeight >= user.weight_kg) {
        await reply(ctx,
            `Target (${targetWeight} kg) harus lebih kecil dari berat sekarang (${user.weight_kg} kg) ya!\n` +
            `Contoh: \`/target ${Math.round(user.weight_kg - 5)}\``
        );
        return;
    }

    await db.setTargetWeight(tgId, targetWeight);

    const deficit      = parseInt(process.env.CALORIE_DEFICIT) || 500;
    const weeklyLossKg = (deficit * 7) / 7700;
    const totalLoss    = user.weight_kg - targetWeight;
    const weeksNeeded  = Math.ceil(totalLoss / weeklyLossKg);
    const targetDate   = new Date();
    targetDate.setDate(targetDate.getDate() + weeksNeeded * 7);
    const targetDateStr = targetDate.toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    await reply(ctx,
        `🎯 *Target Tersimpan!*\n\n` +
        `Berat sekarang: *${user.weight_kg} kg*\n` +
        `Target: *${targetWeight} kg*\n` +
        `Harus turun: *${totalLoss.toFixed(1)} kg*\n\n` +
        `📅 Estimasi: *~${weeksNeeded} minggu*\n` +
        `Kira-kira: *${targetDateStr}*\n\n` +
        `💪 You got this!`
    );
}

async function handleRemind(ctx) {
    const tgId  = ctx.from.id;
    const user  = await db.getUser(tgId);
    const args  = ctx.message.text.split(' ');
    const input = args[1]?.toLowerCase();

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    if (!input) {
        await reply(ctx,
            `⏰ Reminder lo: *${user.reminder_time ? user.reminder_time + ' WIB ✅' : 'off ❌'}*\n\n` +
            `Set: \`/remind 07:00\`\n` +
            `Matiin: \`/remind off\``
        );
        return;
    }

    if (input === 'off') {
        await db.setReminderTime(tgId, null);
        await reply(ctx, `✅ Reminder dimatiin!`);
        return;
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(input)) {
        await reply(ctx, `Format salah! Pakai HH:MM\nContoh: \`/remind 07:00\``);
        return;
    }

    await db.setReminderTime(tgId, input);
    await reply(ctx, `✅ Reminder aktif jam *${input} WIB* setiap hari! 🕐`);
}

// ─── NEW: MENU ────────────────────────────────────────────────

/**
 * /menu — tampilkan daftar menu tersimpan
 * User bisa klik menu → langsung ke-log ke hari ini
 */
async function handleMenu(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const menus = await db.getSavedMenus(tgId);

    if (menus.length === 0) {
        await reply(ctx,
            `📭 *Menu Tersimpan Lo Masih Kosong*\n\n` +
            `Caranya simpan menu:\n` +
            `1. Kirim foto makanan seperti biasa\n` +
            `2. Setelah analisis selesai, klik tombol *💾 Simpan ke Menu*\n` +
            `3. Kasih nama menu-nya\n\n` +
            `Nanti kalau makan itu lagi, tinggal pilih dari sini! 😊`
        );
        return;
    }

    // Build inline keyboard — setiap menu jadi satu baris tombol
    // Maksimal 10 menu ditampilkan biar gak terlalu panjang
    const displayMenus = menus.slice(0, 10);

    const menuButtons = displayMenus.map(m => ([{
        text: `${m.menu_name} (${Math.round(m.calories)} kkal)${m.use_count > 0 ? ` ×${m.use_count}` : ''}`,
        callback_data: `log_menu_${m.id}` // callback buat log menu ini
    }]));

    // Tombol hapus menu di baris terakhir
    menuButtons.push([{ text: '🗑️ Hapus Menu', callback_data: 'show_delete_menu' }]);

    await ctx.reply(
        `🍽️ *Menu Tersimpan Lo (${menus.length}):*\n\n` +
        `Pilih menu di bawah buat langsung log ke hari ini! 👇\n\n` +
        `_${menus.length > 10 ? `Showing 10 dari ${menus.length} menu` : ''}_`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: menuButtons }
        }
    );
}

// ─── NEW: CATAT MANUAL ───────────────────────────────────────

/**
 * /catat [deskripsi makanan] — log makanan tanpa foto
 * User ketik langsung apa yang dimakan, Gemini estimasi nutrisinya
 *
 * Contoh:
 *   /catat nasi goreng 1 porsi, telur mata sapi 2
 *   /catat indomie goreng 1 bungkus + telur
 *   /catat ayam geprek 1 potong nasi putih
 */
async function handleCatat(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! 😅 Ketik /mulai dulu ya.`);
        return;
    }

    // Ambil teks setelah "/catat "
    const fullText  = ctx.message.text || '';
    const foodInput = fullText.replace(/^\/catat\s*/i, '').trim();

    // Kalau gak ada input, kasih contoh cara pakainya
    if (!foodInput) {
        await reply(ctx,
            `📝 *Catat Makanan Manual*\n\n` +
            `Format: \`/catat [deskripsi makanan]\`\n\n` +
            `*Contoh:*\n` +
            `• \`/catat nasi goreng 1 porsi\`\n` +
            `• \`/catat indomie goreng + telur 2 butir\`\n` +
            `• \`/catat ayam geprek 1 ekor, nasi putih, es teh\`\n` +
            `• \`/catat roti tawar 2 lembar + selai kacang\`\n\n` +
            `_Makin detail deskripsinya, makin akurat estimasinya!_ 💡`
        );
        return;
    }

    // Validasi panjang input
    if (foodInput.length > 300) {
        await reply(ctx, `Deskripsinya terlalu panjang. Maksimal 300 karakter ya!`);
        return;
    }

    // Kirim loading message
    const loadingMsg = await reply(ctx,
        `Sebentar ya... 🔍\n_Gemini lagi estimasi nutrisi "${foodInput}"..._`
    );

    try {
        // Estimasi nutrisi dari teks — tanpa foto!
        const result = await gemini.estimateNutritionFromText(foodInput);

        // Kalau Gemini bilang bukan makanan
        if (!result.is_food) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, loadingMsg.message_id, null,
                `Hmm, gua gak ngerti itu makanan apa... 🤔\n\n` +
                `Coba tulis lebih spesifik ya!\n` +
                `Contoh: \`/catat nasi goreng 1 porsi\``
            );
            return;
        }

        // Simpan ke food_logs — sama persis kayak dari foto
        const savedLog = await db.insertFoodLog(tgId, {
            food_description: result.food_description,
            calories:         result.calories,
            protein_g:        result.protein_g,
            carbs_g:          result.carbs_g,
            fat_g:            result.fat_g,
            gemini_raw:       result.gemini_raw
        });

        // Simpan ke memory buat fitur simpan ke menu
        lastLogIdMap.set(tgId, savedLog.id);
        lastResultMap.set(tgId, result);

        // Hitung sisa kalori
        const summary   = await db.getDailySummary(tgId);
        const remaining = user.daily_calorie_goal - (summary.total_calories || 0);

        const statusEmoji   = remaining > 0 ? '✅' : '🚨';
        const remainingText = remaining > 0
            ? `Sisa: *${Math.round(remaining)} kkal* buat hari ini`
            : `⚠️ Over *${Math.abs(Math.round(remaining))} kkal* dari target!`;

        await ctx.telegram.editMessageText(
            ctx.chat.id, loadingMsg.message_id, null,
            `${statusEmoji} *Makanan Tercatat!*\n\n` +
            `📝 *${result.food_description}*\n\n` +
            `🔥 Kalori: *${result.calories} kkal*\n` +
            `💪 Protein: *${result.protein_g}g*\n` +
            `🍚 Karbo: *${result.carbs_g}g*\n` +
            `🥑 Lemak: *${result.fat_g}g*\n` +
            `${result.notes ? `\n📌 _Asumsi: ${result.notes}_\n` : ''}` +
            `${result.confidence === 'low' ? '\n⚠️ _Confidence rendah — coba tulis lebih detail_\n' : ''}` +
            `\n_Estimasi by Gemini 2.5 Flash_ 🤖\n\n` +
            `━━━━━━━━━━━━━━\n` +
            `📊 *Progress Hari Ini (${Math.round(user.daily_calorie_goal)} kkal target):*\n` +
            `${remainingText}`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '💾 Simpan ke Menu', callback_data: 'save_to_menu' },
                        { text: '✏️ Koreksi',        callback_data: 'adjust_last'  }
                    ]]
                }
            }
        );

    } catch (err) {
        console.error(`[CatatHandler] Error for ${tgId}:`, err.message);
        const errMsg = {
            'RATE_LIMIT':   `⏳ Gemini overload. Tunggu ~1 menit ya!`,
            'GEMINI_ERROR': `😵 Ada error. Coba lagi!`,
        }[err.message] || `❌ Something went wrong. Coba lagi!`;

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, errMsg)
            .catch(() => reply(ctx, errMsg));
    }
}

// ─── TEXT HANDLER ────────────────────────────────────────────

async function handleText(ctx) {
    const tgId = ctx.from.id;
    const body = ctx.message.text?.trim() || '';
    const user = await db.getUser(tgId);

    // ── Mode: input nama menu buat disimpan ──────────────────
    if (saveMenuModeMap.has(tgId)) {
        await handleSaveMenuInput(ctx, tgId, body);
        return;
    }

    // ── Mode: adjust deskripsi ───────────────────────────────
    if (adjustModeMap.has(tgId)) {
        await handleAdjustInput(ctx, tgId, body);
        return;
    }

    // ── Cancel commands ──────────────────────────────────────
    if (body.toLowerCase() === '/batal' || body.toLowerCase() === 'batal') {
        adjustModeMap.delete(tgId);
        saveMenuModeMap.delete(tgId);
        await reply(ctx, `Oke, dibatalin! 👌`);
        return;
    }

    if (!user) {
        await reply(ctx, `Heyy! 👋 Ketik /mulai buat daftar ya. 🚀`);
        return;
    }

    if (user.is_registered && user.registration_step === 'complete') {
        await reply(ctx,
            `Hai ${user.name}! 👋\n\nKirim *foto makanan* atau ketik /help! 😊`
        );
        return;
    }

    await processRegistrationStep(ctx, tgId, user, body);
}

/**
 * Handle input nama menu — dipanggil setelah user klik "💾 Simpan ke Menu"
 */
async function handleSaveMenuInput(ctx, tgId, menuName) {
    if (!menuName || menuName.length < 2) {
        await reply(ctx, `Nama menu minimal 2 karakter ya. Coba lagi!`);
        return;
    }
    if (menuName.length > 100) {
        await reply(ctx, `Nama menu terlalu panjang (max 100 karakter). Coba lagi!`);
        return;
    }

    // Ambil data nutrisi dari last result Gemini yang disimpan di memory
    const lastResult = lastResultMap.get(tgId);

    if (!lastResult) {
        saveMenuModeMap.delete(tgId);
        await reply(ctx, `😵 Data analisis udah expired. Kirim foto lagi ya!`);
        return;
    }

    try {
        await db.saveMenu(tgId, {
            menu_name:        menuName,
            food_description: lastResult.food_description,
            calories:         lastResult.calories,
            protein_g:        lastResult.protein_g,
            carbs_g:          lastResult.carbs_g,
            fat_g:            lastResult.fat_g
        });

        saveMenuModeMap.delete(tgId); // keluar dari save menu mode

        await reply(ctx,
            `✅ *Menu "${menuName}" tersimpan!*\n\n` +
            `🔥 ${lastResult.calories} kkal • ` +
            `💪 ${lastResult.protein_g}g protein • ` +
            `🍚 ${lastResult.carbs_g}g karbo • ` +
            `🥑 ${lastResult.fat_g}g lemak\n\n` +
            `Lain kali makan ini lagi, tinggal /menu dan pilih! 😊`
        );
    } catch (err) {
        await reply(ctx, `😵 Gagal simpan menu. Coba lagi ya!`);
    }
}

async function handleAdjustInput(ctx, tgId, newDescription) {
    const logId = adjustModeMap.get(tgId);

    if (!newDescription || newDescription.length < 3) {
        await reply(ctx, `Deskripsinya terlalu pendek. Coba tulis lebih detail!`);
        return;
    }

    try {
        await db.updateFoodLogDescription(logId, newDescription);
        adjustModeMap.delete(tgId);
        await reply(ctx,
            `✅ *Deskripsi berhasil diupdate!*\n\n🍽️ *${newDescription}*\n\n` +
            `_Kalori & nutrisi tetap dari estimasi awal Gemini ya._`
        );
    } catch {
        await reply(ctx, `😵 Gagal update. Coba lagi ya!`);
    }
}

// ─── REGISTRATION FLOW ────────────────────────────────────────

async function processRegistrationStep(ctx, tgId, user, body) {
    const step = user?.registration_step || 'idle';

    switch (step) {
        case 'ask_name': {
            if (body.length < 2 || body.length > 50) {
                await reply(ctx, `Nama harus 2-50 karakter. Coba lagi! 😊`);
                return;
            }
            await db.upsertUser(tgId, { name: body, registration_step: 'ask_age' });
            await reply(ctx, `Nice, *${body}*! 😄\n\n*Umur lo berapa?*\n_(contoh: 25)_`);
            break;
        }
        case 'ask_age': {
            const age = parseInt(body);
            if (isNaN(age) || age < 10 || age > 120) {
                await reply(ctx, `Umur harus angka 10-120. Coba lagi!`);
                return;
            }
            await db.upsertUser(tgId, { age, registration_step: 'ask_gender' });
            await ctx.reply(`Got it! *Gender lo?*`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[
                    { text: '👨 Pria',   callback_data: 'gender_pria'   },
                    { text: '👩 Wanita', callback_data: 'gender_wanita' }
                ]]}
            });
            break;
        }
        case 'ask_height': {
            const height = parseFloat(body);
            if (isNaN(height) || height < 100 || height > 250) {
                await reply(ctx, `Tinggi harus 100-250 cm. Coba lagi!`);
                return;
            }
            await db.upsertUser(tgId, { height_cm: height, registration_step: 'ask_weight' });
            await reply(ctx, `*Berat badan lo berapa kg?*\n_(contoh: 75)_`);
            break;
        }
        case 'ask_weight': {
            const weight = parseFloat(body);
            if (isNaN(weight) || weight < 20 || weight > 500) {
                await reply(ctx, `Berat harus 20-500 kg. Coba lagi!`);
                return;
            }
            await db.upsertUser(tgId, { weight_kg: weight, registration_step: 'ask_activity' });
            await ctx.reply(`Almost done! 🎯 *Level aktivitas fisik lo?*`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [
                    [{ text: '🛋️ Santai banget',              callback_data: 'activity_sedentary'   }],
                    [{ text: '🚶 Gerak dikit (1-3x/minggu)',   callback_data: 'activity_light'       }],
                    [{ text: '🏃 Lumayan aktif (3-5x/minggu)', callback_data: 'activity_moderate'    }],
                    [{ text: '💪 Aktif banget (6-7x/minggu)',  callback_data: 'activity_active'      }],
                    [{ text: '🏋️ Super aktif / Atlet',        callback_data: 'activity_very_active' }]
                ]}
            });
            break;
        }
        default:
            await db.updateRegistrationStep(tgId, 'idle');
            await reply(ctx, `Hmm error nih. Ketik /mulai lagi ya!`);
    }
}

// ─── CALLBACK QUERY HANDLER ───────────────────────────────────

async function handleCallbackQuery(ctx) {
    const tgId = ctx.from.id;
    const data = ctx.callbackQuery.data;

    await ctx.answerCbQuery();

    // ── Reset ────────────────────────────────────────────────
    if (data === 'confirm_reset') {
        try {
            const deleted = await db.deleteTodayLogs(tgId);
            lastLogIdMap.delete(tgId);
            lastResultMap.delete(tgId);
            adjustModeMap.delete(tgId);
            await ctx.editMessageText(
                `✅ *Reset berhasil!* ${deleted} log dihapus. Fresh start! 💪`,
                { parse_mode: 'Markdown' }
            );
        } catch {
            await ctx.editMessageText(`❌ Gagal reset. Coba lagi!`);
        }
        return;
    }

    if (data === 'cancel_reset') {
        await ctx.editMessageText(`Oke, log hari ini aman! 👌`);
        return;
    }

    // ── Update profil ────────────────────────────────────────
    if (data === 'update_profile') {
        await db.upsertUser(tgId, { registration_step: 'ask_name', is_registered: false });
        await ctx.editMessageText(`Oke, let's update profil lo! 📝`);
        await reply(ctx, `*Nama panggilan lo siapa?*`);
        return;
    }

    // ── Gender ───────────────────────────────────────────────
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

    // ── Activity ─────────────────────────────────────────────
    if (data.startsWith('activity_')) {
        const activityLevel = data.replace('activity_', '');
        const user = await db.getUser(tgId);
        const bmr       = calc.calculateBMR(user.weight_kg, user.height_cm, user.age, user.gender);
        const tdee      = calc.calculateTDEE(bmr, activityLevel);
        const dailyGoal = calc.calculateDailyGoal(tdee);

        await db.upsertUser(tgId, {
            activity_level: activityLevel, bmr, tdee,
            daily_calorie_goal: dailyGoal,
            is_registered: true, registration_step: 'complete'
        });

        await ctx.editMessageText(
            `Aktivitas: *${calc.ACTIVITY_LABELS[activityLevel]}* ✅`,
            { parse_mode: 'Markdown' }
        );
        await reply(ctx,
            `Yeaay! Profil *tersimpan*! 🎉\n\n` +
            calc.formatCalorieReport(bmr, tdee, dailyGoal, activityLevel) +
            `\n\n_Let's get healthy! 💪_`
        );
        return;
    }

    // ── Simpan ke menu (setelah analisis foto) ───────────────
    if (data === 'save_to_menu') {
        saveMenuModeMap.set(tgId, true); // aktifkan save menu mode
        await ctx.editMessageText(
            ctx.callbackQuery.message.text + '\n\n✏️ _Ketik nama untuk menu ini:_',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // ── Log menu yang dipilih dari /menu ─────────────────────
    if (data.startsWith('log_menu_')) {
        const menuId = parseInt(data.replace('log_menu_', ''));
        const user   = await db.getUser(tgId);
        const menu   = await db.getSavedMenuById(menuId, tgId);

        if (!menu) {
            await ctx.answerCbQuery('Menu tidak ditemukan!', { show_alert: true });
            return;
        }

        // Log langsung ke food_logs hari ini
        await db.insertFoodLog(tgId, {
            food_description: menu.food_description,
            calories:         menu.calories,
            protein_g:        menu.protein_g,
            carbs_g:          menu.carbs_g,
            fat_g:            menu.fat_g
        });

        // Increment use_count biar menu ini naik ke atas list
        await db.incrementMenuUseCount(menuId);

        // Hitung sisa kalori
        const summary   = await db.getDailySummary(tgId);
        const remaining = user.daily_calorie_goal - (summary.total_calories || 0);

        const statusEmoji   = remaining > 0 ? '✅' : '🚨';
        const remainingText = remaining > 0
            ? `Sisa: *${Math.round(remaining)} kkal* buat hari ini`
            : `⚠️ Over *${Math.abs(Math.round(remaining))} kkal* dari target!`;

        await ctx.editMessageText(
            `${statusEmoji} *"${menu.menu_name}" ke-log!*\n\n` +
            `🔥 ${Math.round(menu.calories)} kkal • ` +
            `💪 ${menu.protein_g}g • ` +
            `🍚 ${menu.carbs_g}g • ` +
            `🥑 ${menu.fat_g}g\n\n` +
            `━━━━━━━━━━━━━━\n` +
            `📊 *Progress Hari Ini:*\n${remainingText}`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // ── Tampilkan list hapus menu ─────────────────────────────
    if (data === 'show_delete_menu') {
        const menus = await db.getSavedMenus(tgId);

        if (menus.length === 0) {
            await ctx.answerCbQuery('Gak ada menu yang bisa dihapus!', { show_alert: true });
            return;
        }

        const deleteButtons = menus.slice(0, 10).map(m => ([{
            text: `🗑️ ${m.menu_name}`,
            callback_data: `delete_menu_${m.id}`
        }]));

        deleteButtons.push([{ text: '← Balik', callback_data: 'back_to_menu' }]);

        await ctx.editMessageText(
            `🗑️ *Pilih menu yang mau dihapus:*`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: deleteButtons }
            }
        );
        return;
    }

    // ── Hapus menu tertentu ───────────────────────────────────
    if (data.startsWith('delete_menu_')) {
        const menuId = parseInt(data.replace('delete_menu_', ''));
        const menu   = await db.getSavedMenuById(menuId, tgId);

        if (!menu) {
            await ctx.answerCbQuery('Menu tidak ditemukan!', { show_alert: true });
            return;
        }

        await db.deleteMenu(menuId, tgId);
        await ctx.answerCbQuery(`"${menu.menu_name}" dihapus!`, { show_alert: true });

        // Refresh list menu setelah hapus
        const remainingMenus = await db.getSavedMenus(tgId);

        if (remainingMenus.length === 0) {
            await ctx.editMessageText(
                `📭 Semua menu udah dihapus.\n\nKirim foto makanan buat simpan menu baru!`
            );
            return;
        }

        const deleteButtons = remainingMenus.slice(0, 10).map(m => ([{
            text: `🗑️ ${m.menu_name}`,
            callback_data: `delete_menu_${m.id}`
        }]));
        deleteButtons.push([{ text: '← Balik', callback_data: 'back_to_menu' }]);

        await ctx.editMessageText(
            `🗑️ *Pilih menu yang mau dihapus:*`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: deleteButtons } }
        );
        return;
    }

    // ── Balik ke list menu ────────────────────────────────────
    if (data === 'back_to_menu') {
        const menus = await db.getSavedMenus(tgId);
        const menuButtons = menus.slice(0, 10).map(m => ([{
            text: `${m.menu_name} (${Math.round(m.calories)} kkal)${m.use_count > 0 ? ` ×${m.use_count}` : ''}`,
            callback_data: `log_menu_${m.id}`
        }]));
        menuButtons.push([{ text: '🗑️ Hapus Menu', callback_data: 'show_delete_menu' }]);

        await ctx.editMessageText(
            `🍽️ *Menu Tersimpan Lo (${menus.length}):*\n\nPilih menu buat log ke hari ini! 👇`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: menuButtons } }
        );
        return;
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

    // Clear mode apapun yang aktif
    adjustModeMap.delete(tgId);
    saveMenuModeMap.delete(tgId);

    const loadingMsg = await reply(ctx, `Sebentar ya... 🔍\n_Gemini lagi analisis makanannya..._`);

    try {
        const photos    = ctx.message.photo;
        const bestPhoto = photos[photos.length - 1];
        const fileInfo  = await ctx.telegram.getFile(bestPhoto.file_id);
        const fileUrl   = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

        const imageBuffer = await gemini.downloadImage(fileUrl);
        const result      = await gemini.analyzeFoodImage(imageBuffer, 'image/jpeg');

        if (!result.is_food) {
            await ctx.telegram.editMessageText(
                ctx.chat.id, loadingMsg.message_id, null,
                `Hmm, kayaknya bukan foto makanan deh... 🤔\nCoba kirim foto yang ada makanannya! 📸`
            );
            return;
        }

        // Simpan ke food_logs
        const savedLog = await db.insertFoodLog(tgId, {
            food_description: result.food_description,
            calories:  result.calories,
            protein_g: result.protein_g,
            carbs_g:   result.carbs_g,
            fat_g:     result.fat_g,
            gemini_raw: result.gemini_raw
        });

        // Simpan ke memory buat /adjust dan save menu
        lastLogIdMap.set(tgId, savedLog.id);
        lastResultMap.set(tgId, result); // simpan full result buat fitur save menu

        const summary   = await db.getDailySummary(tgId);
        const remaining = user.daily_calorie_goal - (summary.total_calories || 0);

        const statusEmoji   = remaining > 0 ? '✅' : '🚨';
        const remainingText = remaining > 0
            ? `Sisa: *${Math.round(remaining)} kkal* buat hari ini`
            : `⚠️ Over *${Math.abs(Math.round(remaining))} kkal* dari target!`;

        await ctx.telegram.editMessageText(
            ctx.chat.id, loadingMsg.message_id, null,
            `${statusEmoji} *Hasil Analisis Makanan:*\n\n` +
            `🍽️ *${result.food_description}*\n\n` +
            `🔥 Kalori: *${result.calories} kkal*\n` +
            `💪 Protein: *${result.protein_g}g*\n` +
            `🍚 Karbo: *${result.carbs_g}g*\n` +
            `🥑 Lemak: *${result.fat_g}g*\n` +
            `${result.confidence === 'low' ? '\n⚠️ _Confidence rendah, coba foto lebih jelas_\n' : ''}` +
            `\n_Estimasi by Gemini 2.5 Flash_ 🤖\n\n` +
            `━━━━━━━━━━━━━━\n` +
            `📊 *Progress Hari Ini (${Math.round(user.daily_calorie_goal)} kkal target):*\n` +
            `${remainingText}`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        // Tombol simpan ke menu — muncul otomatis setelah analisis
                        { text: '💾 Simpan ke Menu', callback_data: 'save_to_menu' },
                        { text: '✏️ Koreksi',        callback_data: 'adjust_last'  }
                    ]]
                }
            }
        );

    } catch (err) {
        console.error(`[PhotoHandler] Error for ${tgId}:`, err.message);
        const errMsg = {
            'RATE_LIMIT':   `⏳ Gemini overload. Tunggu ~1 menit ya!`,
            'SAFETY_BLOCK': `🚫 Gambar gak bisa diproses.`,
            'GEMINI_ERROR': `😵 Ada error. Coba kirim ulang!`,
        }[err.message] || `❌ Something went wrong. Coba lagi!`;

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
    handleStreak, handleTarget, handleRemind,
    handleMenu, handleCatat,
    handleText, handleCallbackQuery, handlePhoto
};