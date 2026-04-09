// ============================================================
// src/services/database.js
// Update: tambah fungsi deleteTodayLogs & updateFoodLog
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
    return data; // return data biar bisa dapet ID-nya (dipake buat /adjust)
}

/**
 * Update deskripsi makanan di log tertentu (dipake buat /adjust)
 * @param {number} logId - ID row di food_logs
 * @param {string} newDescription - deskripsi baru dari user
 */
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

/**
 * Hapus semua log makanan hari ini untuk user tertentu (dipake buat /reset)
 * @param {number} telegramId
 * @returns {number} jumlah row yang dihapus
 */
async function deleteTodayLogs(telegramId) {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('food_logs')
        .delete()
        .eq('telegram_id', telegramId)
        .eq('log_date', today)
        .select(); // select buat tau berapa row yang kehapus

    if (error) {
        console.error('[DB] deleteTodayLogs error:', error.message);
        throw new Error('Gagal reset log hari ini');
    }

    return data?.length || 0; // jumlah log yang dihapus
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
    insertFoodLog,
    updateFoodLogDescription,
    deleteTodayLogs,
    getDailySummary,
    getWeeklyLogs
};