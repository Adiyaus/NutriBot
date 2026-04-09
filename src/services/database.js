// ============================================================
// src/services/database.js
// Update: tambah getStreak, setTargetWeight, setReminderTime,
//         getUsersWithReminder
// ============================================================

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ─── USER QUERIES ─────────────────────────────────────────────

async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('[DB] getUser error:', error.message);
    }
    return data;
}

async function upsertUser(telegramId, updates) {
    const { data, error } = await supabase
        .from('users')
        .upsert(
            { telegram_id: telegramId, ...updates, updated_at: new Date().toISOString() },
            { onConflict: 'telegram_id' }
        )
        .select()
        .single();

    if (error) {
        console.error('[DB] upsertUser error:', error.message);
        throw new Error('Gagal nyimpen data user');
    }
    return data;
}

async function updateRegistrationStep(telegramId, step) {
    const { error } = await supabase
        .from('users')
        .update({ registration_step: step, updated_at: new Date().toISOString() })
        .eq('telegram_id', telegramId);

    if (error) console.error('[DB] updateStep error:', error.message);
}

// ─── STREAK QUERIES ───────────────────────────────────────────

/**
 * Hitung streak harian user — berapa hari berturut-turut ada log makanan
 * Logic: mulai dari kemarin, hitung mundur selama masih ada data
 * (Hari ini tidak dihitung karena mungkin belum selesai)
 *
 * @param {number} telegramId
 * @returns {number} jumlah hari streak
 */
async function getStreak(telegramId) {
    // Ambil semua tanggal unik yang ada log-nya, urut dari terbaru
    const { data, error } = await supabase
        .from('food_logs')
        .select('log_date')
        .eq('telegram_id', telegramId)
        .order('log_date', { ascending: false });

    if (error || !data || data.length === 0) return 0;

    // Ambil tanggal unik saja (bisa ada banyak log per hari)
    const uniqueDates = [...new Set(data.map(r => r.log_date))];

    let streak     = 0;
    const today    = new Date();
    today.setHours(0, 0, 0, 0);

    // Mulai cek dari hari ini mundur
    // Kalau hari ini udah ada log, hitung. Kalau belum, mulai dari kemarin
    let checkDate = new Date(today);

    for (let i = 0; i < uniqueDates.length; i++) {
        const dateStr = checkDate.toISOString().split('T')[0]; // format YYYY-MM-DD

        if (uniqueDates.includes(dateStr)) {
            streak++;                                  // ada log di hari ini → tambah streak
            checkDate.setDate(checkDate.getDate() - 1); // mundur 1 hari
        } else {
            break; // gak ada log di hari itu → streak putus, stop
        }
    }

    return streak;
}

// ─── TARGET WEIGHT ────────────────────────────────────────────

/**
 * Set target berat badan user
 * @param {number} telegramId
 * @param {number} targetWeight - target berat dalam kg
 */
async function setTargetWeight(telegramId, targetWeight) {
    const { error } = await supabase
        .from('users')
        .update({ target_weight: targetWeight, updated_at: new Date().toISOString() })
        .eq('telegram_id', telegramId);

    if (error) {
        console.error('[DB] setTargetWeight error:', error.message);
        throw new Error('Gagal set target berat');
    }
}

// ─── REMINDER ─────────────────────────────────────────────────

/**
 * Set waktu reminder harian user
 * @param {number} telegramId
 * @param {string|null} time - format 'HH:MM' atau null buat matiin reminder
 */
async function setReminderTime(telegramId, time) {
    const { error } = await supabase
        .from('users')
        .update({ reminder_time: time, updated_at: new Date().toISOString() })
        .eq('telegram_id', telegramId);

    if (error) {
        console.error('[DB] setReminderTime error:', error.message);
        throw new Error('Gagal set reminder');
    }
}

/**
 * Ambil semua user yang punya reminder di jam tertentu
 * Dipanggil setiap menit oleh cron job
 * @param {string} time - format 'HH:MM'
 * @returns {Array} list user yang perlu diremind sekarang
 */
async function getUsersWithReminder(time) {
    const { data, error } = await supabase
        .from('users')
        .select('telegram_id, name, daily_calorie_goal, reminder_time')
        .eq('reminder_time', time)       // filter by jam reminder
        .eq('is_registered', true);      // hanya user yang sudah terdaftar

    if (error) {
        console.error('[DB] getUsersWithReminder error:', error.message);
        return [];
    }
    return data || [];
}

// ─── FOOD LOG QUERIES ─────────────────────────────────────────

async function insertFoodLog(telegramId, nutritionData) {
    const { data, error } = await supabase
        .from('food_logs')
        .insert({
            telegram_id: telegramId,
            log_date: new Date().toISOString().split('T')[0],
            ...nutritionData,
            logged_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('[DB] insertFoodLog error:', error.message);
        throw new Error('Gagal nyimpen food log');
    }
    return data;
}

async function updateFoodLogDescription(logId, newDescription) {
    const { error } = await supabase
        .from('food_logs')
        .update({ food_description: newDescription })
        .eq('id', logId);

    if (error) {
        console.error('[DB] updateFoodLog error:', error.message);
        throw new Error('Gagal update food log');
    }
}

async function deleteTodayLogs(telegramId) {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('food_logs')
        .delete()
        .eq('telegram_id', telegramId)
        .eq('log_date', today)
        .select();

    if (error) {
        console.error('[DB] deleteTodayLogs error:', error.message);
        throw new Error('Gagal reset log hari ini');
    }
    return data?.length || 0;
}

async function getDailySummary(telegramId) {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('daily_summary')
        .select('*')
        .eq('telegram_id', telegramId)
        .eq('log_date', today)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('[DB] getDailySummary error:', error.message);
    }

    return data || {
        total_calories: 0, total_protein: 0,
        total_carbs: 0, total_fat: 0, meal_count: 0
    };
}

async function getWeeklyLogs(telegramId) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
        .from('food_logs')
        .select('log_date, calories, protein_g, carbs_g, fat_g')
        .eq('telegram_id', telegramId)
        .gte('log_date', sevenDaysAgo.toISOString().split('T')[0])
        .order('log_date', { ascending: true });

    if (error) {
        console.error('[DB] getWeeklyLogs error:', error.message);
        return [];
    }
    return data;
}

module.exports = {
    getUser,
    upsertUser,
    updateRegistrationStep,
    getStreak,
    setTargetWeight,
    setReminderTime,
    getUsersWithReminder,
    insertFoodLog,
    updateFoodLogDescription,
    deleteTodayLogs,
    getDailySummary,
    getWeeklyLogs
};