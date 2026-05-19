// ============================================================
// src/services/nutritionCache.js
// Cache layer nutrisi di Supabase
//
// Flow:
//   get(key)  → return per100g data atau null (cache miss)
//   set(key, data) → simpan ke DB, update hit_count kalau sudah ada
//
// Table: nutrition_cache (lihat schema_cache.sql)
// ============================================================

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// TTL default: 30 hari — data nutrisi jarang berubah drastis
const CACHE_TTL_DAYS = parseInt(process.env.NUTRITION_CACHE_TTL_DAYS) || 30;

// ─── GET ──────────────────────────────────────────────────────

/**
 * Ambil data nutrisi dari cache berdasarkan cache key
 *
 * @param {string} cacheKey - normalized key dari normalizeFood()
 * @returns {object|null} per100g nutrition data, atau null jika miss/expired
 *
 * @example
 * const cached = await nutritionCache.get('nasi_goreng');
 * // → { calories_per100g: 174, protein_per100g: 4.3, ... } | null
 */
async function get(cacheKey) {
    if (!cacheKey) return null;

    try {
        const { data, error } = await supabase
            .from('nutrition_cache')
            .select('*')
            .eq('cache_key', cacheKey)
            .single();

        if (error || !data) return null;

        // Cek TTL — kalau sudah expired, anggap miss (data akan di-refresh)
        const ageMs  = Date.now() - new Date(data.updated_at).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > CACHE_TTL_DAYS) {
            console.log(`[Cache] EXPIRED: ${cacheKey} (${Math.round(ageDays)} hari)`);
            return null;
        }

        // Increment hit_count secara async — jangan await biar gak blocking
        supabase
            .from('nutrition_cache')
            .update({ hit_count: (data.hit_count || 0) + 1, updated_at: new Date().toISOString() })
            .eq('cache_key', cacheKey)
            .then(() => {})
            .catch(() => {});

        console.log(`[Cache] HIT: ${cacheKey} (${data.data_source})`);

        return {
            calories_per100g: Number(data.calories_per100g),
            protein_per100g:  Number(data.protein_per100g),
            carbs_per100g:    Number(data.carbs_per100g),
            fat_per100g:      Number(data.fat_per100g),
            food_name:        data.food_name,
            data_source:      data.data_source,
            confidence:       data.confidence,
        };

    } catch (err) {
        // Cache error jangan throw — cukup log, lanjut ke fallback berikutnya
        console.error('[Cache] get error:', err.message);
        return null;
    }
}

// ─── SET ──────────────────────────────────────────────────────

/**
 * Simpan atau update data nutrisi ke cache
 *
 * @param {string} cacheKey   - normalized key dari normalizeFood()
 * @param {string} foodName   - nama tampilan makanan
 * @param {object} per100g    - { calories_per100g, protein_per100g, carbs_per100g, fat_per100g }
 * @param {string} dataSource - 'indonesian_dataset' | 'usda' | 'openfoodfacts' | 'gemini_estimate'
 * @param {string} [confidence] - 'high' | 'medium' | 'low'
 * @returns {boolean} true jika berhasil
 */
async function set(cacheKey, foodName, per100g, dataSource, confidence = 'medium') {
    if (!cacheKey || !per100g) return false;

    // Jangan cache kalori 0 — data invalid
    if (!per100g.calories_per100g || per100g.calories_per100g <= 0) {
        console.warn(`[Cache] Skip set: kalori 0 untuk ${cacheKey}`);
        return false;
    }

    try {
        const { error } = await supabase
            .from('nutrition_cache')
            .upsert({
                cache_key:        cacheKey,
                food_name:        foodName || cacheKey,
                calories_per100g: Math.round(per100g.calories_per100g),
                protein_per100g:  parseFloat((per100g.protein_per100g || 0).toFixed(1)),
                carbs_per100g:    parseFloat((per100g.carbs_per100g   || 0).toFixed(1)),
                fat_per100g:      parseFloat((per100g.fat_per100g     || 0).toFixed(1)),
                data_source:      dataSource,
                confidence:       confidence,
                updated_at:       new Date().toISOString(),
            }, {
                onConflict: 'cache_key',
                // Update semua field kecuali hit_count dan created_at
                ignoreDuplicates: false,
            });

        if (error) {
            console.error('[Cache] set error:', error.message);
            return false;
        }

        console.log(`[Cache] SET: ${cacheKey} → ${per100g.calories_per100g} kcal/100g (${dataSource})`);
        return true;

    } catch (err) {
        console.error('[Cache] set exception:', err.message);
        return false;
    }
}

// ─── DELETE (untuk invalidasi manual) ────────────────────────

/**
 * Hapus entry cache — misal kalau data ketauan salah
 *
 * @param {string} cacheKey
 * @returns {boolean}
 */
async function invalidate(cacheKey) {
    if (!cacheKey) return false;

    try {
        const { error } = await supabase
            .from('nutrition_cache')
            .delete()
            .eq('cache_key', cacheKey);

        if (error) {
            console.error('[Cache] invalidate error:', error.message);
            return false;
        }

        console.log(`[Cache] INVALIDATED: ${cacheKey}`);
        return true;

    } catch (err) {
        console.error('[Cache] invalidate exception:', err.message);
        return false;
    }
}

// ─── STATS (opsional, untuk monitoring) ──────────────────────

/**
 * Ambil statistik cache — top 10 most hit items
 * Berguna untuk debugging & monitoring
 *
 * @returns {Array}
 */
async function getStats() {
    try {
        const { data } = await supabase
            .from('nutrition_cache')
            .select('cache_key, food_name, data_source, hit_count, updated_at')
            .order('hit_count', { ascending: false })
            .limit(10);

        return data || [];
    } catch {
        return [];
    }
}

module.exports = { get, set, invalidate, getStats };