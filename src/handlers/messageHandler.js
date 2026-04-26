// ============================================================
// src/handlers/messageHandler.js
// Update: tambah fitur saved menus (/menu, simpan, pilih, hapus)
// ============================================================

const db     = require('../services/database');
const gemini = require('../services/gemini');
const calc   = require('../utils/calculator');

const lastLogIdMap    = new Map();
const lastResultMap   = new Map();
const adjustModeMap   = new Map();
const editModeMap     = new Map();
const saveMenuModeMap = new Map();
const inputModeMap    = new Map();
const photoContextMap = new Map();
const coachHistoryMap = new Map(); // simpan history percakapan /tanya per user
// coachHistoryMap value: Array of { role: 'user'|'assistant', content: string }
// Max 10 pesan terakhir biar gak kebanyakan token

// ─── KEYBOARD LAYOUT ─────────────────────────────────────────

/**
 * Reply keyboard permanen yang nempel di bawah chat
 * Dibagi per baris sesuai kategori biar rapi
 */
const MAIN_KEYBOARD = {
    reply_markup: {
        keyboard: [
            // Baris 1: tracking harian
            ['📸 Kirim Foto', '/catat', '/input'],
            // Baris 2: cek status
            ['/status', '/laporan', '/streak'],
            // Baris 3: menu & tools
            ['/menu', '/tanya', '/target'],
            // Baris 4: setting & misc
            ['/remind', '/profil', '/help'],
            // Baris 5: koreksi
            ['/adjust', '/hapus', '/reset']
        ],
        resize_keyboard:   true,  // otomatis sesuaikan ukuran tombol
        persistent:        true   // keyboard tetap muncul, gak hilang setelah tap
    }
};

async function reply(ctx, text, extra = {}) {
    // Merge MAIN_KEYBOARD ke setiap reply — keyboard selalu muncul
    // Tapi kalau ada inline_keyboard di extra, jangan override reply_markup-nya
    const hasInlineKeyboard = extra?.reply_markup?.inline_keyboard;

    const mergedExtra = hasInlineKeyboard
        ? { parse_mode: 'Markdown', ...extra }                          // pakai inline keyboard dari caller
        : { parse_mode: 'Markdown', ...MAIN_KEYBOARD, ...extra };       // inject main keyboard

    return ctx.reply(text, mergedExtra);
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
        `*/input* — input nutrisi manual (template)\n` +
        `*/tanya [pertanyaan]* — tanya coach soal diet & nutrisi\n` +
        `*/lupain* — reset history percakapan coach\n` +
        `*/profil* — lihat & update data profil\n` +
        `*/reset* — hapus semua log hari ini\n` +
        `*/hapus* — hapus 1 log spesifik hari ini\n` +
        `*/adjust* — koreksi log terakhir (nama/angka)\n` +
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

    // Ambil summary + list makanan hari ini secara paralel (lebih cepat)
    const [summary, foodList] = await Promise.all([
        db.getDailySummary(tgId),
        db.getTodayFoodList(tgId)
    ]);

    await reply(ctx, buildStatusMessage(summary, user.daily_calorie_goal, foodList));
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

/**
 * /hapus — hapus 1 log spesifik hari ini
 * Tampilkan list log hari ini → user pilih mana yang mau dihapus
 */
async function handleHapus(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    const foodList = await db.getTodayFoodList(tgId);

    if (!foodList || foodList.length === 0) {
        await reply(ctx, `📭 Belum ada log makanan hari ini yang bisa dihapus!`);
        return;
    }

    // Build inline keyboard — tiap log jadi 1 tombol
    const buttons = foodList.map(food => {
        // Truncate nama biar muat di tombol
        const name = food.food_description.length > 30
            ? food.food_description.substring(0, 30) + '...'
            : food.food_description;

        // Format jam WIB dari logged_at
        const loggedAt = new Date(food.logged_at);
        const wibHour  = String((loggedAt.getUTCHours() + 7) % 24).padStart(2, '0');
        const wibMin   = String(loggedAt.getUTCMinutes()).padStart(2, '0');

        return [{
            text: `🗑️ ${wibHour}:${wibMin} — ${name} (${Math.round(food.calories)} kkal)`,
            callback_data: `hapus_log_${food.id}`
        }];
    });

    buttons.push([{ text: '❌ Batalin', callback_data: 'cancel_hapus' }]);

    await ctx.reply(
        `🗑️ *Pilih log yang mau dihapus:*\n\n` +
        `_Hari ini ada ${foodList.length} log makanan_`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        }
    );
}

async function handleAdjust(ctx) {
    const tgId      = ctx.from.id;
    const user      = await db.getUser(tgId);
    const lastLogId = lastLogIdMap.get(tgId);
    const lastResult = lastResultMap.get(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! Ketik /mulai dulu ya.`);
        return;
    }

    if (!lastLogId) {
        await reply(ctx, `Belum ada log terakhir nih. Kirim foto, /catat, atau /input dulu ya! 📸`);
        return;
    }

    // Tampilkan data log terakhir + 2 opsi edit via inline keyboard
    await ctx.reply(
        `✏️ *Koreksi Log Terakhir:*\n\n` +
        `🍽️ ${lastResult?.food_description || 'Makanan'}\n` +
        `🔥 ${lastResult?.calories || 0} kkal • ` +
        `💪 ${lastResult?.protein_g || 0}g • ` +
        `🍚 ${lastResult?.carbs_g || 0}g • ` +
        `🥑 ${lastResult?.fat_g || 0}g\n\n` +
        `Mau koreksi yang mana?`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📝 Edit Nama/Deskripsi', callback_data: 'edit_desc'    }],
                    [{ text: '🔢 Edit Angka Nutrisi',  callback_data: 'edit_numbers' }],
                    [{ text: '❌ Batalin',              callback_data: 'cancel_edit'  }]
                ]
            }
        }
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
const MENU_PAGE_SIZE = 8; // menu per halaman

/**
 * Build inline keyboard untuk list menu dengan pagination
 */
function buildMenuKeyboard(menus, page = 0, mode = 'log') {
    const totalPages = Math.ceil(menus.length / MENU_PAGE_SIZE);
    const start      = page * MENU_PAGE_SIZE;
    const pageMenus  = menus.slice(start, start + MENU_PAGE_SIZE);

    // Tombol menu di halaman ini
    const buttons = pageMenus.map(m => ([{
        text: mode === 'log'
            ? `${m.menu_name} (${Math.round(m.calories)} kkal)${m.use_count > 0 ? ` ×${m.use_count}` : ''}`
            : `🗑️ ${m.menu_name}`,
        callback_data: mode === 'log'
            ? `log_menu_${m.id}`
            : `delete_menu_${m.id}`
    }]));

    // Baris navigasi: Prev | halaman | Next
    const navRow = [];
    if (page > 0) {
        navRow.push({ text: '← Prev', callback_data: `menu_page_${mode}_${page - 1}` });
    }
    if (totalPages > 1) {
        navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' });
    }
    if (page < totalPages - 1) {
        navRow.push({ text: 'Next →', callback_data: `menu_page_${mode}_${page + 1}` });
    }
    if (navRow.length > 0) buttons.push(navRow);

    // Action button bawah
    if (mode === 'log') {
        buttons.push([{ text: '🗑️ Hapus Menu', callback_data: 'show_delete_menu' }]);
    } else {
        buttons.push([{ text: '← Balik', callback_data: 'back_to_menu' }]);
    }

    return buttons;
}

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

    await ctx.reply(
        `🍽️ *Menu Tersimpan Lo (${menus.length}):*\n\n` +
        `Pilih menu di bawah buat langsung log ke hari ini! 👇`,
        {
            parse_mode:   'Markdown',
            reply_markup: { inline_keyboard: buildMenuKeyboard(menus, 0, 'log') }
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

    // Clear semua mode yang mungkin aktif — biar gak ada konflik state
    inputModeMap.delete(tgId);
    editModeMap.delete(tgId);
    adjustModeMap.delete(tgId);
    saveMenuModeMap.delete(tgId);

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

    // Kirim loading message TANPA keyboard — biar bisa di-edit setelah Gemini selesai
    const loadingMsg = await ctx.reply(
        `Sebentar ya... 🔍\n_Gemini lagi estimasi nutrisi "${foodInput}"..._`,
        { parse_mode: 'Markdown' }
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

    // ── Mode: nunggu konteks foto ────────────────────────────
    // Dicek PERTAMA biar gak bentrok sama mode lain
    if (photoContextMap.has(tgId)) {
        await handlePhotoContext(ctx, tgId, body);
        return;
    }

    // ── Mode: input manual nutrisi ───────────────────────────
    if (inputModeMap.has(tgId)) {
        await handleInputStep(ctx, tgId, body);
        return;
    }

    // ── Mode: edit angka nutrisi ─────────────────────────────
    if (editModeMap.has(tgId)) {
        await handleEditStep(ctx, tgId, body);
        return;
    }

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
        inputModeMap.delete(tgId);
        editModeMap.delete(tgId);
        photoContextMap.delete(tgId);
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

        // Update lastResult juga biar konsisten
        const lastResult = lastResultMap.get(tgId);
        if (lastResult) lastResultMap.set(tgId, { ...lastResult, food_description: newDescription });

        await reply(ctx,
            `✅ *Deskripsi berhasil diupdate!*\n\n🍽️ *${newDescription}*`
        );
    } catch {
        await reply(ctx, `😵 Gagal update. Coba lagi ya!`);
    }
}

/**
 * Handle step-by-step edit angka nutrisi
 * State machine: ask_calories → ask_protein → ask_carbs → ask_fat → done
 */
async function handleEditStep(ctx, tgId, body) {
    const state = editModeMap.get(tgId);
    if (!state) return;

    const user = await db.getUser(tgId);

    switch (state.step) {

        case 'ask_calories': {
            const val = parseFloat(body);
            if (isNaN(val) || val < 0 || val > 5000) {
                await reply(ctx, `Kalori harus angka 0-5000. Coba lagi!`);
                return;
            }
            editModeMap.set(tgId, { ...state, step: 'ask_protein', calories: val });
            await reply(ctx,
                `🔥 Kalori: *${val} kkal* ✅\n\n` +
                `*Protein berapa gram?*\n_(ketik angka baru, atau ketik sama kayak sebelumnya: ${state.protein_g}g)_`
            );
            break;
        }

        case 'ask_protein': {
            const val = parseFloat(body);
            if (isNaN(val) || val < 0 || val > 500) {
                await reply(ctx, `Protein harus angka 0-500. Coba lagi!`);
                return;
            }
            editModeMap.set(tgId, { ...state, step: 'ask_carbs', protein_g: val });
            await reply(ctx,
                `💪 Protein: *${val}g* ✅\n\n` +
                `*Karbohidrat berapa gram?*\n_(sebelumnya: ${state.carbs_g}g)_`
            );
            break;
        }

        case 'ask_carbs': {
            const val = parseFloat(body);
            if (isNaN(val) || val < 0 || val > 1000) {
                await reply(ctx, `Karbo harus angka 0-1000. Coba lagi!`);
                return;
            }
            editModeMap.set(tgId, { ...state, step: 'ask_fat', carbs_g: val });
            await reply(ctx,
                `🍚 Karbo: *${val}g* ✅\n\n` +
                `*Lemak berapa gram?*\n_(sebelumnya: ${state.fat_g}g)_`
            );
            break;
        }

        case 'ask_fat': {
            const val = parseFloat(body);
            if (isNaN(val) || val < 0 || val > 500) {
                await reply(ctx, `Lemak harus angka 0-500. Coba lagi!`);
                return;
            }

            const updates = {
                calories:  state.calories,
                protein_g: state.protein_g,
                carbs_g:   state.carbs_g,
                fat_g:     val
            };

            editModeMap.delete(tgId);

            try {
                await db.updateFoodLog(state.logId, tgId, updates);

                // Update lastResult di memory biar /adjust selanjutnya dapet data terbaru
                lastResultMap.set(tgId, {
                    ...lastResultMap.get(tgId),
                    ...updates
                });

                // Hitung ulang progress hari ini
                const summary   = await db.getDailySummary(tgId);
                const remaining = user.daily_calorie_goal - (summary.total_calories || 0);
                const remainingText = remaining > 0
                    ? `Sisa: *${Math.round(remaining)} kkal*`
                    : `Over *${Math.abs(Math.round(remaining))} kkal* dari target`;

                await reply(ctx,
                    `✅ *Nutrisi berhasil diupdate!*\n\n` +
                    `🍽️ *${state.food_description}*\n\n` +
                    `🔥 Kalori: *${state.calories} kkal*\n` +
                    `💪 Protein: *${state.protein_g}g*\n` +
                    `🍚 Karbo: *${state.carbs_g}g*\n` +
                    `🥑 Lemak: *${val}g*\n\n` +
                    `📊 ${remainingText} buat hari ini`
                );

            } catch (err) {
                await reply(ctx, `😵 Gagal update. Coba lagi ya!`);
            }
            break;
        }
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

    // ── Edit deskripsi ───────────────────────────────────────
    if (data === 'edit_desc') {
        const lastLogId = lastLogIdMap.get(tgId);
        adjustModeMap.set(tgId, lastLogId);
        await ctx.editMessageText(`✏️ Ketik nama/deskripsi makanan yang bener:\n\n_Atau /batal untuk cancel_`, { parse_mode: 'Markdown' });
        return;
    }

    // ── Edit angka nutrisi ───────────────────────────────────
    if (data === 'edit_numbers') {
        const lastLogId  = lastLogIdMap.get(tgId);
        const lastResult = lastResultMap.get(tgId);

        // Set state edit dengan data saat ini sebagai default
        editModeMap.set(tgId, {
            step:             'ask_calories',
            logId:            lastLogId,
            food_description: lastResult?.food_description || '',
            calories:         lastResult?.calories  || 0,
            protein_g:        lastResult?.protein_g || 0,
            carbs_g:          lastResult?.carbs_g   || 0,
            fat_g:            lastResult?.fat_g     || 0
        });

        await ctx.editMessageText(
            `🔢 *Edit Angka Nutrisi*\n\n` +
            `Gua tanya satu-satu ya. Ketik /batal untuk cancel.\n\n` +
            `*Kalori berapa kkal?*\n_(sebelumnya: ${lastResult?.calories || 0} kkal)_`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    if (data === 'cancel_edit') {
        adjustModeMap.delete(tgId);
        editModeMap.delete(tgId);
        await ctx.editMessageText(`Oke, log gak diubah! 👌`);
        return;
    }

    // ── Hapus log spesifik ───────────────────────────────────
    if (data.startsWith('hapus_log_')) {
        const logId = parseInt(data.replace('hapus_log_', ''));
        const user  = await db.getUser(tgId);

        try {
            await db.deleteLogById(logId, tgId);

            // Kalau yang dihapus adalah last log, clear memory
            if (lastLogIdMap.get(tgId) === logId) {
                lastLogIdMap.delete(tgId);
                lastResultMap.delete(tgId);
            }

            const summary   = await db.getDailySummary(tgId);
            const remaining = user.daily_calorie_goal - (summary.total_calories || 0);

            await ctx.editMessageText(
                `✅ *Log berhasil dihapus!*\n\n` +
                `📊 Sisa kalori sekarang: *${Math.round(remaining > 0 ? remaining : 0)} kkal*`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            await ctx.editMessageText(`❌ Gagal hapus log. Coba lagi ya!`);
        }
        return;
    }

    if (data === 'cancel_hapus') {
        await ctx.editMessageText(`Oke, gak jadi hapus! 👌`);
        return;
    }

    // ── Skip konteks foto — langsung analisis tanpa konteks ──
    if (data === 'photo_skip_context') {
        await ctx.answerCbQuery();
        const photoData = photoContextMap.get(tgId);
        if (!photoData) {
            await ctx.editMessageText(`Foto udah expired. Kirim ulang ya! 📸`);
            return;
        }
        await ctx.editMessageText(`Oke, langsung analisis! 🔍`);
        await processPhotoAnalysis(ctx, tgId, photoData.fileUrl, '');
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
        // Clear semua mode lain dulu biar gak ada konflik
        // Ini root cause bug: inputModeMap yang masih ke-set dari /input sebelumnya
        // bikin teks nama menu salah masuk ke handleInputStep
        inputModeMap.delete(tgId);
        editModeMap.delete(tgId);
        adjustModeMap.delete(tgId);

        saveMenuModeMap.set(tgId, true);
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

        await ctx.editMessageText(
            `🗑️ *Pilih menu yang mau dihapus:*\n_(${menus.length} menu)_`,
            {
                parse_mode:   'Markdown',
                reply_markup: { inline_keyboard: buildMenuKeyboard(menus, 0, 'delete') }
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

        const remainingMenus = await db.getSavedMenus(tgId);

        if (remainingMenus.length === 0) {
            await ctx.editMessageText(
                `📭 Semua menu udah dihapus.\n\nKirim foto makanan buat simpan menu baru!`
            );
            return;
        }

        await ctx.editMessageText(
            `🗑️ *Pilih menu yang mau dihapus:*\n_(${remainingMenus.length} menu)_`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildMenuKeyboard(remainingMenus, 0, 'delete') } }
        );
        return;
    }

    // ── Navigasi halaman menu (log & delete mode) ─────────────
    if (data.startsWith('menu_page_')) {
        // format: menu_page_log_2 atau menu_page_delete_2
        const parts  = data.split('_');            // ['menu','page','log','2']
        const mode   = parts[2];                   // 'log' atau 'delete'
        const page   = parseInt(parts[3]);
        const menus  = await db.getSavedMenus(tgId);

        const headerText = mode === 'log'
            ? `🍽️ *Menu Tersimpan Lo (${menus.length}):*\n\nPilih menu buat log ke hari ini! 👇`
            : `🗑️ *Pilih menu yang mau dihapus:*\n_(${menus.length} menu)_`;

        await ctx.editMessageText(
            headerText,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildMenuKeyboard(menus, page, mode) } }
        );
        return;
    }

    // ── Tombol noop (label halaman, gak ngapa-ngapain) ────────
    if (data === 'noop') {
        await ctx.answerCbQuery();
        return;
    }

    // ── Balik ke list menu ────────────────────────────────────
    if (data === 'back_to_menu') {
        const menus = await db.getSavedMenus(tgId);
        await ctx.editMessageText(
            `🍽️ *Menu Tersimpan Lo (${menus.length}):*\n\nPilih menu buat log ke hari ini! 👇`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buildMenuKeyboard(menus, 0, 'log') } }
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

    // Clear semua mode yang aktif
    adjustModeMap.delete(tgId);
    saveMenuModeMap.delete(tgId);
    inputModeMap.delete(tgId);
    editModeMap.delete(tgId);
    photoContextMap.delete(tgId);

    try {
        // Ambil file info foto dulu — simpan ke memory buat diproses setelah konteks
        const photos    = ctx.message.photo;
        const bestPhoto = photos[photos.length - 1];
        const fileInfo  = await ctx.telegram.getFile(bestPhoto.file_id);
        const fileUrl   = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

        // Simpan foto ke memory, tunggu konteks dari user
        photoContextMap.set(tgId, { fileUrl });

        // Tanya konteks — pakai inline keyboard buat opsi skip
        await ctx.reply(
            `📸 Foto diterima!\n\n` +
            `*Ada info tambahan tentang makanannya?*\n` +
            `_(contoh: "nasi goreng spesial warung bu Tini", "porsi besar", "pakai santan")_\n\n` +
            `Info tambahan bikin estimasi lebih akurat! 🎯`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '⚡ Skip, langsung analisis', callback_data: 'photo_skip_context' }
                    ]]
                }
            }
        );

    } catch (err) {
        console.error(`[PhotoHandler] Error get file for ${tgId}:`, err.message);
        await reply(ctx, `❌ Gagal ambil foto. Coba kirim ulang ya!`);
    }
}

/**
 * Handle konteks teks yang dikirim user setelah foto
 * Dipanggil dari handleText waktu photoContextMap aktif
 */
async function handlePhotoContext(ctx, tgId, context) {
    const photoData = photoContextMap.get(tgId);
    if (!photoData) return;

    // Langsung proses dengan konteks yang diberikan
    await processPhotoAnalysis(ctx, tgId, photoData.fileUrl, context.trim());
}

/**
 * Core: download foto + kirim ke Gemini + log hasilnya
 * Dipanggil dari handlePhotoContext atau callback skip
 */
async function processPhotoAnalysis(ctx, tgId, fileUrl, userContext = '') {
    const user = await db.getUser(tgId);
    photoContextMap.delete(tgId); // hapus dari memory

    // Loading message TANPA keyboard — biar bisa di-edit
    const loadingMsg = await ctx.reply(
        userContext
            ? `Sebentar ya... 🔍\n_Gemini analisis dengan konteks: "${userContext}"..._`
            : `Sebentar ya... 🔍\n_Gemini lagi analisis makanannya..._`,
        { parse_mode: 'Markdown' }
    );

    try {
        const imageBuffer = await gemini.downloadImage(fileUrl);
        const result      = await gemini.analyzeFoodImage(imageBuffer, 'image/jpeg', userContext);

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

// ─── NEW: INPUT MANUAL NUTRISI ───────────────────────────────

/**
 * /input — input makanan manual dengan template nutrisi
 * Bot tanya step by step: nama → kalori → protein → karbo → lemak
 * Cocok kalau user tau data nutrisinya (dari kemasan, dll)
 */
async function handleInput(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! 😅 Ketik /mulai dulu ya.`);
        return;
    }

    // Cek apakah ada argumen setelah /input — kalau ada, coba parse template langsung
    const fullText  = ctx.message.text || '';
    const afterCmd  = fullText.replace(/^\/input\s*/i, '').trim();

    if (afterCmd) {
        // User langsung ketik: /input Nasi Padang | 650 25 80 20
        await handleInputTemplate(ctx, tgId, afterCmd, user);
        return;
    }

    // Mulai state machine tanya satu-satu
    inputModeMap.set(tgId, { step: 'ask_name' });

    await reply(ctx,
        `📝 *Input Nutrisi Manual*\n\n` +
        `*Cara cepat (1 pesan):*\n` +
        `\`/input Nama Makanan | kalori protein karbo lemak\`\n` +
        `_Contoh: \`/input Nasi Padang | 650 25 80 20\`_\n\n` +
        `*Cara biasa (step by step):*\n` +
        `Ketik nama makanannya sekarang 👇\n` +
        `_(atau /batal buat cancel)_`
    );
}

/**
 * Parse dan log template input sekaligus: "Nasi Padang | 650 25 80 20"
 * Format: [nama] | [kalori] [protein] [karbo] [lemak]
 * Protein, karbo, lemak opsional — bisa diisi 0
 */
async function handleInputTemplate(ctx, tgId, text, user) {
    // Split by | atau koma — support dua format
    const parts = text.split(/\|/).map(s => s.trim());

    if (parts.length < 2) {
        // Gak ada separator — anggap user cuma mau mulai step-by-step dengan nama
        inputModeMap.set(tgId, { step: 'ask_calories', name: text });
        await reply(ctx,
            `Oke, *"${text}"* ✅\n\n` +
            `*Kalorinya berapa? (kkal)*\n_(contoh: 450 — atau ketik 0 kalau gak tau)_`
        );
        return;
    }

    const name      = parts[0];
    const numbers   = parts[1].trim().split(/\s+/).map(Number);

    // Validasi nama
    if (!name || name.length < 2) {
        await reply(ctx, `Nama makanan minimal 2 karakter ya!\nContoh: \`/input Nasi Goreng | 650 22 80 18\``);
        return;
    }

    // Validasi angka — minimal kalori harus ada
    if (numbers.length === 0 || isNaN(numbers[0])) {
        await reply(ctx,
            `Format angkanya salah nih!\n\n` +
            `Yang bener: \`/input ${name} | kalori protein karbo lemak\`\n` +
            `Contoh: \`/input ${name} | 650 25 80 20\``
        );
        return;
    }

    const calories  = Math.max(0, numbers[0] || 0);
    const protein_g = Math.max(0, numbers[1] || 0);
    const carbs_g   = Math.max(0, numbers[2] || 0);
    const fat_g     = Math.max(0, numbers[3] || 0);

    // Validasi range
    if (calories > 5000) {
        await reply(ctx, `Kalori kayaknya kegedean nih (max 5000). Cek lagi ya!`);
        return;
    }

    try {
        const savedLog = await db.insertFoodLog(tgId, {
            food_description: name,
            calories, protein_g, carbs_g, fat_g
        });

        lastLogIdMap.set(tgId, savedLog.id);
        lastResultMap.set(tgId, { food_description: name, calories, protein_g, carbs_g, fat_g });

        const summary   = await db.getDailySummary(tgId);
        const remaining = user.daily_calorie_goal - (summary.total_calories || 0);

        const statusEmoji   = remaining > 0 ? '✅' : '🚨';
        const remainingText = remaining > 0
            ? `Sisa: *${Math.round(remaining)} kkal* buat hari ini`
            : `⚠️ Over *${Math.abs(Math.round(remaining))} kkal* dari target!`;

        await reply(ctx,
            `${statusEmoji} *Makanan Tercatat!*\n\n` +
            `🍽️ *${name}*\n\n` +
            `🔥 Kalori: *${calories} kkal*\n` +
            `💪 Protein: *${protein_g}g*\n` +
            `🍚 Karbo: *${carbs_g}g*\n` +
            `🥑 Lemak: *${fat_g}g*\n\n` +
            `_Input manual_ ✍️\n\n` +
            `━━━━━━━━━━━━━━\n` +
            `📊 *Progress Hari Ini (${Math.round(user.daily_calorie_goal)} kkal target):*\n` +
            `${remainingText}`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '💾 Simpan ke Menu', callback_data: 'save_to_menu' },
                        { text: '✏️ Koreksi',        callback_data: 'adjust_last'  }
                    ]]
                }
            }
        );
    } catch (err) {
        console.error(`[InputTemplate] Error for ${tgId}:`, err.message);
        await reply(ctx, `😵 Gagal nyimpen. Coba lagi ya!`);
    }
}

/**
 * Handle setiap step input manual — dipanggil dari handleText
 * State machine: ask_name → ask_calories → ask_protein → ask_carbs → ask_fat → done
 */
async function handleInputStep(ctx, tgId, body) {
    const state = inputModeMap.get(tgId);
    if (!state) return;

    const user = await db.getUser(tgId);

    switch (state.step) {

        case 'ask_name': {
            if (body.length < 2 || body.length > 100) {
                await reply(ctx, `Nama makanan harus 2-100 karakter. Coba lagi!`);
                return;
            }
            // Simpan nama, lanjut ke step kalori
            inputModeMap.set(tgId, { ...state, step: 'ask_calories', name: body });
            await reply(ctx,
                `Oke, *"${body}"* ✅\n\n` +
                `*Kalorinya berapa? (kkal)*\n` +
                `_(ketik angkanya aja, contoh: 450)_\n` +
                `_Gak tau? Ketik 0_`
            );
            break;
        }

        case 'ask_calories': {
            const calories = parseFloat(body);
            if (isNaN(calories) || calories < 0 || calories > 5000) {
                await reply(ctx, `Kalori harus angka 0-5000. Coba lagi!`);
                return;
            }
            inputModeMap.set(tgId, { ...state, step: 'ask_protein', calories });
            await reply(ctx,
                `*Protein berapa gram?*\n` +
                `_(contoh: 25.5)_\n` +
                `_Gak tau? Ketik 0_`
            );
            break;
        }

        case 'ask_protein': {
            const protein = parseFloat(body);
            if (isNaN(protein) || protein < 0 || protein > 500) {
                await reply(ctx, `Protein harus angka 0-500 gram. Coba lagi!`);
                return;
            }
            inputModeMap.set(tgId, { ...state, step: 'ask_carbs', protein_g: protein });
            await reply(ctx,
                `*Karbohidrat berapa gram?*\n` +
                `_(contoh: 60)_\n` +
                `_Gak tau? Ketik 0_`
            );
            break;
        }

        case 'ask_carbs': {
            const carbs = parseFloat(body);
            if (isNaN(carbs) || carbs < 0 || carbs > 1000) {
                await reply(ctx, `Karbo harus angka 0-1000 gram. Coba lagi!`);
                return;
            }
            inputModeMap.set(tgId, { ...state, step: 'ask_fat', carbs_g: carbs });
            await reply(ctx,
                `*Lemak berapa gram?*\n` +
                `_(contoh: 15)_\n` +
                `_Gak tau? Ketik 0_`
            );
            break;
        }

        case 'ask_fat': {
            const fat = parseFloat(body);
            if (isNaN(fat) || fat < 0 || fat > 500) {
                await reply(ctx, `Lemak harus angka 0-500 gram. Coba lagi!`);
                return;
            }

            // Semua data terkumpul — simpan ke food_logs
            const finalData = {
                food_description: state.name,
                calories:         state.calories,
                protein_g:        state.protein_g,
                carbs_g:          state.carbs_g,
                fat_g:            fat
            };

            // Hapus dari state map dulu sebelum DB call
            inputModeMap.delete(tgId);

            try {
                const savedLog = await db.insertFoodLog(tgId, finalData);

                // Simpan ke memory buat /adjust dan save menu
                lastLogIdMap.set(tgId, savedLog.id);
                lastResultMap.set(tgId, finalData);

                // Hitung progress hari ini
                const summary   = await db.getDailySummary(tgId);
                const remaining = user.daily_calorie_goal - (summary.total_calories || 0);

                const statusEmoji   = remaining > 0 ? '✅' : '🚨';
                const remainingText = remaining > 0
                    ? `Sisa: *${Math.round(remaining)} kkal* buat hari ini`
                    : `⚠️ Over *${Math.abs(Math.round(remaining))} kkal* dari target!`;

                await reply(ctx,
                    `${statusEmoji} *Makanan Tercatat!*\n\n` +
                    `🍽️ *${finalData.food_description}*\n\n` +
                    `🔥 Kalori: *${finalData.calories} kkal*\n` +
                    `💪 Protein: *${finalData.protein_g}g*\n` +
                    `🍚 Karbo: *${finalData.carbs_g}g*\n` +
                    `🥑 Lemak: *${finalData.fat_g}g*\n\n` +
                    `_Input manual — data dari lo sendiri_ ✍️\n\n` +
                    `━━━━━━━━━━━━━━\n` +
                    `📊 *Progress Hari Ini (${Math.round(user.daily_calorie_goal)} kkal target):*\n` +
                    `${remainingText}`,
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💾 Simpan ke Menu', callback_data: 'save_to_menu' },
                                { text: '✏️ Koreksi',        callback_data: 'adjust_last'  }
                            ]]
                        }
                    }
                );

            } catch (err) {
                console.error(`[InputHandler] DB error for ${tgId}:`, err.message);
                await reply(ctx, `😵 Gagal nyimpen. Coba lagi ya!`);
            }
            break;
        }
    }
}

/**
 * /lupain — reset history percakapan coach
 */
async function handleLupain(ctx) {
    const tgId = ctx.from.id;
    const history = coachHistoryMap.get(tgId) || [];

    if (history.length === 0) {
        await reply(ctx, `Belum ada percakapan yang perlu di-reset. Tanya dulu lewat /tanya! 😊`);
        return;
    }

    const turnCount = Math.floor(history.length / 2);
    coachHistoryMap.delete(tgId);

    await reply(ctx,
        `🧹 *History percakapan direset!*\n\n` +
        `${turnCount} pertanyaan sebelumnya udah dilupain.\n` +
        `Coach siap mulai percakapan baru! 😊`
    );
}

// ─── NEW: TANYA COACH ─────────────────────────────────────────

async function handleTanya(ctx) {
    const tgId = ctx.from.id;
    const user = await db.getUser(tgId);

    if (!user?.is_registered) {
        await reply(ctx, `Lo belum daftar nih! 😅 Ketik /mulai dulu ya.`);
        return;
    }

    const fullText = ctx.message.text || '';
    const question = fullText.replace(/^\/tanya\s*/i, '').trim();

    // Command /tanya tanpa pertanyaan → tampilkan menu + info memory
    if (!question) {
        const history    = coachHistoryMap.get(tgId) || [];
        const hasHistory = history.length > 0;

        await reply(ctx,
            `🤔 *Tanya Apa ke Coach?*\n\n` +
            `Format: \`/tanya [pertanyaan lo]\`\n\n` +
            `*Contoh:*\n` +
            `• \`/tanya olahraga apa yang cocok buat aku?\`\n` +
            `• \`/tanya kenapa aku lapar terus?\`\n` +
            `• \`/tanya berapa protein yang aku butuhkan?\`\n` +
            `• \`/tanya boleh makan nasi malam hari ga?\`\n\n` +
            `${hasHistory
                ? `🧠 _Coach masih ingat ${Math.floor(history.length / 2)} pertanyaan terakhir lo._\n` +
                  `_Ketik /lupain buat reset percakapan._`
                : `_Coach bakal jawab berdasarkan data profil lo!_ 💪`
            }`
        );
        return;
    }

    if (question.length > 500) {
        await reply(ctx, `Pertanyaannya terlalu panjang. Maksimal 500 karakter ya!`);
        return;
    }

    // Ambil history percakapan user yang ada
    const history = coachHistoryMap.get(tgId) || [];

    const loadingMsg = await ctx.reply(
        history.length > 0
            ? `🤔 *Coach lagi mikir...*\n_Mengingat konteks percakapan sebelumnya..._`
            : `🤔 *Coach lagi mikir...*\n_Menyesuaikan jawaban dengan profil lo..._`,
        { parse_mode: 'Markdown' }
    );

    try {
        const todaySummary = await db.getDailySummary(tgId);

        // Kirim pertanyaan + history ke Gemini
        const answer = await gemini.generateCoachAnswer(user, todaySummary, question, history);

        // Simpan Q&A ke history — max 10 pesan (5 pasang Q&A) biar hemat token
        history.push({ role: 'user',      content: question });
        history.push({ role: 'assistant', content: answer   });

        // Trim ke 10 pesan terakhir kalau lebih
        if (history.length > 10) history.splice(0, history.length - 10);

        coachHistoryMap.set(tgId, history);

        const turnCount = Math.floor(history.length / 2);

        await ctx.telegram.editMessageText(
            ctx.chat.id, loadingMsg.message_id, null,
            `💬 *Coach NutriBot:*\n\n` +
            `_"${question}"_\n\n` +
            `━━━━━━━━━━━━━━\n\n` +
            `${answer}\n\n` +
            `_🧠 Coach ingat ${turnCount} pertanyaan · /tanya lagi atau /lupain buat reset_`,
            { parse_mode: 'Markdown' }
        );

    } catch (err) {
        console.error(`[TanyaHandler] Error for ${tgId}:`, err.message);
        const errMsg = err.message === 'RATE_LIMIT'
            ? `⏳ Coach lagi sibuk. Tunggu ~1 menit terus coba lagi ya!`
            : `😵 Ada error. Coba tanya lagi!`;

        await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, errMsg)
            .catch(() => reply(ctx, errMsg));
    }
}

// ─── COACHING HELPER ─────────────────────────────────────────

// ─── HELPERS ─────────────────────────────────────────────────

function buildProgressBar(pct) {
    const filled = Math.round(Math.min(pct, 100) / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/**
 * Build pesan status harian — sekarang include list makanan yang sudah dimakan
 * @param {object} summary - total nutrisi hari ini
 * @param {number} dailyGoal - target kalori
 * @param {Array} foodList - list makanan yang sudah di-log (opsional)
 */
function buildStatusMessage(summary, dailyGoal, foodList = []) {
    const consumed   = Math.round(summary.total_calories || 0);
    const remaining  = Math.round(dailyGoal - consumed);
    const percentage = Math.min(100, Math.round((consumed / dailyGoal) * 100));

    // ── Indikator warna berdasarkan sisa kalori ───────────────
    // 0 API call — pure logic di server
    let statusIndicator, remainingLabel, footerMsg;

    if (remaining < 0) {
        // Over budget
        statusIndicator = '🔴';
        remainingLabel  = `*Over ${Math.abs(remaining)} kkal* dari target!`;
        footerMsg       = '⚠️ _Lo over budget hari ini. Besok bisa lebih baik!_';
    } else if (remaining <= 200) {
        // Hampir habis — kuning
        statusIndicator = '🟡';
        remainingLabel  = `*${remaining} kkal* sisa — udah mepet!`;
        footerMsg       = '⚡ _Sisa kalori mepet. Pilih camilan ringan aja!_';
    } else if (percentage >= 80) {
        // Udah di atas 80% — oranye warning
        statusIndicator = '🟠';
        remainingLabel  = `*${remaining} kkal* sisa`;
        footerMsg       = '👀 _Udah 80%+ dari target. Pantau terus ya!_';
    } else if (percentage >= 50) {
        // Normal — hijau
        statusIndicator = '🟢';
        remainingLabel  = `*${remaining} kkal* sisa`;
        footerMsg       = '✅ _On track! Keep going! 💪_';
    } else {
        // Baru mulai / masih banyak — hijau terang
        statusIndicator = '🟢';
        remainingLabel  = `*${remaining} kkal* sisa`;
        footerMsg       = consumed === 0
            ? '📭 _Belum ada log hari ini. Yuk mulai!_'
            : '✅ _Masih banyak ruang. Keep it up!_';
    }

    // Build food list section
    let foodListText = '';
    if (foodList.length > 0) {
        foodListText = `\n🍽️ *Yang Udah Dimakan:*\n`;
        foodList.forEach((food, i) => {
            const loggedAt  = new Date(food.logged_at);
            const wibHour   = String((loggedAt.getUTCHours() + 7) % 24).padStart(2, '0');
            const wibMinute = String(loggedAt.getUTCMinutes()).padStart(2, '0');
            const timeStr   = `${wibHour}:${wibMinute}`;
            const name      = food.food_description.length > 40
                ? food.food_description.substring(0, 40) + '...'
                : food.food_description;

            foodListText += `${i + 1}. ${name}\n`;
            foodListText += `    _${timeStr} WIB • ${Math.round(food.calories)} kkal_\n`;
        });
    } else {
        foodListText = `\n_Belum ada log makanan hari ini_ 📭\n`;
    }

    return (
        `${statusIndicator} *Status Kalori Hari Ini:*\n\n` +
        `${buildProgressBar(percentage)} ${percentage}%\n\n` +
        `🔥 Terpakai: *${consumed} / ${Math.round(dailyGoal)} kkal*\n` +
        `📉 Sisa: ${remainingLabel}\n\n` +
        `💪 Protein: ${(summary.total_protein || 0).toFixed(1)}g\n` +
        `🍚 Karbo: ${(summary.total_carbs || 0).toFixed(1)}g\n` +
        `🥑 Lemak: ${(summary.total_fat || 0).toFixed(1)}g\n` +
        foodListText +
        `\n${footerMsg}`
    );
}

/**
 * Reset semua in-memory state harian
 * Dipanggil tiap tengah malam oleh cron job
 * Biar /adjust gak nyasar ke log kemarin
 */
function resetDailyMemory() {
    lastLogIdMap.clear();
    lastResultMap.clear();
    adjustModeMap.clear();
    editModeMap.clear();
    saveMenuModeMap.clear();
    inputModeMap.clear();
    photoContextMap.clear();
    coachHistoryMap.clear();
    console.log('[Memory] Daily reset — semua state map cleared');
}

module.exports = {
    handleStart, handleHelp, handleStatus, handleLaporan,
    handleProfil, handleReset, handleHapus, handleAdjust,
    handleStreak, handleTarget, handleRemind,
    handleMenu, handleCatat, handleInput, handleTanya, handleLupain,
    handleText, handleCallbackQuery, handlePhoto,
    resetDailyMemory
};