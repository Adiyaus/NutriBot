// ============================================================
// src/services/nutritionResolver.js
// Orkestrasi fallback chain untuk lookup nutrisi
//
// FLOW (per food item):
//   1. normalizeFood()          → canonical name + cache key
//   2. nutritionCache.get()     → Supabase cache (fastest)
//   3. findFood() local dataset → ~70 makanan Indonesia (no network)
//   4. usda.searchFood()        → USDA FoodData Central API
//   5. off.searchByName()       → OpenFoodFacts API
//   6. gemini.estimateSingleFood() → Gemini AI (last resort)
//
// Semua hasil dari layer 2-5 di-cache untuk request berikutnya.
// Gemini hasil di-cache dengan confidence 'low' — bisa di-refresh kalau ada sumber lebih baik.
//
// PUBLIC API:
//   resolveFromText(foodText)          → buat /catat
//   resolveFromImage(imageBuffer, ctx) → buat foto
//   resolveItems(foodItems)            → buat manual input array
// ============================================================

const { normalizeFood, buildSearchQueries } = require('../utils/normalizeFood');
const { findFood, toNutriFormat: datasetToNutri } = require('../data/indonesianFoods');
const cache  = require('./nutritionCache');
const usda   = require('./usda');
const off    = require('./openfoodfacts');
const gemini = require('./gemini');

// ─── MAIN ENTRY POINTS ────────────────────────────────────────

/**
 * Resolve nutrisi dari teks deskripsi makanan user (/catat)
 *
 * @param {string} foodText - contoh: "nasi goreng 1 piring, telur mata sapi 2 butir"
 * @returns {object} NutriBot result format
 */
async function resolveFromText(foodText) {
    console.log(`[Resolver] resolveFromText: "${foodText}"`);

    // Step 1: Gemini parse teks → food_items dengan portion_g
    let geminiParse;
    try {
        geminiParse = await gemini.estimateNutritionFromText(foodText);
    } catch (err) {
        console.error('[Resolver] Gemini parse gagal:', err.message);
        throw err; // Kalau Gemini parse gagal total, kita memang gak bisa lanjut
    }

    if (!geminiParse.is_food) return geminiParse;

    // Step 2: Resolve nutrisi tiap item via fallback chain
    return _resolveFromGeminiParse(geminiParse);
}

/**
 * Resolve nutrisi dari foto makanan
 *
 * @param {Buffer} imageBuffer
 * @param {string} [userContext] - konteks tambahan dari user
 * @returns {object} NutriBot result format
 */
async function resolveFromImage(imageBuffer, userContext = '') {
    console.log(`[Resolver] resolveFromImage (context: "${userContext}")`);

    // Step 1: Gemini Vision → identifikasi makanan + portion_g
    let geminiParse;
    try {
        geminiParse = await gemini.analyzeFoodImage(imageBuffer, 'image/jpeg', userContext);
    } catch (err) {
        console.error('[Resolver] Gemini vision gagal:', err.message);
        throw err;
    }

    if (!geminiParse.is_food) return geminiParse;

    // Step 2: Resolve nutrisi tiap item
    return _resolveFromGeminiParse(geminiParse);
}

/**
 * Resolve dari array food_items yang sudah ada (e.g. dari saved menu)
 *
 * @param {Array<{name: string, portion_g: number}>} foodItems
 * @param {string} [description]
 * @returns {object} NutriBot result format
 */
async function resolveItems(foodItems, description = '') {
    if (!foodItems || foodItems.length === 0) {
        return _emptyResult(description);
    }

    const resolvedItems = await Promise.all(
        foodItems.map(item => _resolveOneItem(item))
    );

    return _aggregateResults(resolvedItems, description, foodItems);
}

// ─── INTERNAL: RESOLVE FROM GEMINI PARSE ─────────────────────

/**
 * Setelah Gemini identify food_items, resolve nutrisi tiap item via chain
 * lalu aggregate hasilnya
 *
 * @private
 */
async function _resolveFromGeminiParse(geminiParse) {
    const foodItems = geminiParse.food_items || [];

    if (foodItems.length === 0) {
        // Gemini gak detect food_items → fallback ke nilai gemini langsung
        // (ini edge case — biasanya kalau is_food: true pasti ada food_items)
        console.warn('[Resolver] Gemini parse: is_food=true tapi food_items kosong');
        return {
            ...geminiParse,
            data_source: 'gemini_only',
            resolver_chain: 'no_items',
        };
    }

    const resolvedItems = await Promise.all(
        foodItems.map(item => _resolveOneItem(item))
    );

    return _aggregateResults(resolvedItems, geminiParse.food_description, foodItems, geminiParse);
}

// ─── INTERNAL: RESOLVE ONE ITEM ──────────────────────────────

/**
 * Jalankan fallback chain untuk satu food item
 * Return per-item nutrition yang sudah di-scale ke portion_g
 *
 * @private
 * @param {{ name: string, portion_g: number }} item
 * @returns {{ name, portion_g, calories, protein_g, carbs_g, fat_g, source, resolved }}
 */
async function _resolveOneItem(item) {
    const portionG = item.portion_g || 100;
    const { normalized, english, cacheKey } = normalizeFood(item.name);

    console.log(`[Resolver] Item: "${item.name}" → key="${cacheKey}", en="${english}"`);

    // ── Layer 1: Supabase Cache ───────────────────────────
    const cached = await cache.get(cacheKey);
    if (cached) {
        return _scaleToResult(item.name, portionG, cached, 'cache');
    }

    // ── Layer 2: Local Indonesian Dataset ────────────────
    // Coba normalized Indonesia dulu, lalu English
    const localEntry = findFood(normalized) || findFood(english);
    if (localEntry) {
        const per100g = datasetToNutri(localEntry);
        // Simpan ke cache async — jangan blocking
        _cacheAsync(cacheKey, localEntry.display, per100g, 'indonesian_dataset', 'high');
        return _scaleToResult(item.name, portionG, per100g, 'indonesian_dataset');
    }

    // ── Layer 3: USDA API ─────────────────────────────────
    const queries = buildSearchQueries(normalized, english);
    const usdaPer100g = await _tryUSDA(queries, cacheKey);
    if (usdaPer100g) {
        return _scaleToResult(item.name, portionG, usdaPer100g, 'usda');
    }

    // ── Layer 4: OpenFoodFacts API ────────────────────────
    const offPer100g = await _tryOpenFoodFacts(english, cacheKey);
    if (offPer100g) {
        return _scaleToResult(item.name, portionG, offPer100g, 'openfoodfacts');
    }

    // ── Layer 5: Gemini Estimation (last resort) ──────────
    console.warn(`[Resolver] Semua sumber gagal untuk "${item.name}" — fallback ke Gemini`);
    const geminiPer100g = await _tryGeminiEstimate(item.name, portionG, cacheKey);
    if (geminiPer100g) {
        return _scaleToResult(item.name, portionG, geminiPer100g, 'gemini_estimate');
    }

    // ── Complete Failure ──────────────────────────────────
    console.error(`[Resolver] Total gagal untuk item: "${item.name}"`);
    return _failedItem(item.name, portionG);
}

// ─── INTERNAL: LAYER IMPLEMENTATIONS ─────────────────────────

async function _tryUSDA(queries, cacheKey) {
    for (const query of queries) {
        try {
            const results = await usda.searchFood(query, 1);
            if (results.length === 0) continue;

            const best = results[0];
            if (!best.calories_per100g || best.calories_per100g <= 0) continue;

            const per100g = {
                calories_per100g: best.calories_per100g,
                protein_per100g:  best.protein_per100g  || 0,
                carbs_per100g:    best.carbs_per100g    || 0,
                fat_per100g:      best.fat_per100g      || 0,
                food_name:        best.description,
                data_source:      'usda',
                confidence:       'high',
            };

            _cacheAsync(cacheKey, best.description, per100g, 'usda', 'high');
            console.log(`[Resolver] USDA hit: "${query}" → ${best.calories_per100g} kcal/100g`);
            return per100g;

        } catch (err) {
            console.warn(`[Resolver] USDA error untuk "${query}":`, err.message);
            // Lanjut ke query berikutnya atau layer berikutnya
        }
    }
    return null;
}

async function _tryOpenFoodFacts(english, cacheKey) {
    try {
        const result = await off.searchByName(english);
        if (!result) return null;

        const per100g = {
            calories_per100g: result.per_100g.calories,
            protein_per100g:  result.per_100g.protein_g,
            carbs_per100g:    result.per_100g.carbs_g,
            fat_per100g:      result.per_100g.fat_g,
            food_name:        result.product_name,
            data_source:      'openfoodfacts',
            confidence:       result.completeness > 0.6 ? 'high' : 'medium',
        };

        _cacheAsync(cacheKey, result.product_name, per100g, 'openfoodfacts', per100g.confidence);
        console.log(`[Resolver] OFF hit: "${english}" → ${result.per_100g.calories} kcal/100g`);
        return per100g;

    } catch (err) {
        console.warn('[Resolver] OpenFoodFacts error:', err.message);
        return null;
    }
}

async function _tryGeminiEstimate(foodName, portionG, cacheKey) {
    try {
        const result = await gemini.estimateSingleFood(foodName, portionG);
        if (!result || result.calories_per100g <= 0) return null;

        const per100g = {
            calories_per100g: result.calories_per100g,
            protein_per100g:  result.protein_per100g  || 0,
            carbs_per100g:    result.carbs_per100g    || 0,
            fat_per100g:      result.fat_per100g      || 0,
            food_name:        result.food_name || foodName,
            data_source:      'gemini_estimate',
            confidence:       'low', // selalu low untuk Gemini estimate
        };

        // Cache Gemini estimate dengan TTL lebih pendek (7 hari)
        // — kalau ada sumber lebih baik nanti, bisa di-refresh
        _cacheAsync(cacheKey, per100g.food_name, per100g, 'gemini_estimate', 'low');
        return per100g;

    } catch (err) {
        console.error('[Resolver] Gemini estimate error:', err.message);
        return null;
    }
}

// ─── INTERNAL: SCALE & AGGREGATE ─────────────────────────────

/**
 * Scale per100g nutrition ke actual portion_g
 * @private
 */
function _scaleToResult(name, portionG, per100g, source) {
    const scale = portionG / 100;
    return {
        name,
        portion_g:  portionG,
        calories:   Math.round((per100g.calories_per100g || 0) * scale),
        protein_g:  parseFloat(((per100g.protein_per100g || 0) * scale).toFixed(1)),
        carbs_g:    parseFloat(((per100g.carbs_per100g   || 0) * scale).toFixed(1)),
        fat_g:      parseFloat(((per100g.fat_per100g     || 0) * scale).toFixed(1)),
        source,
        food_name:  per100g.food_name || name,
        resolved:   true,
    };
}

function _failedItem(name, portionG) {
    return {
        name,
        portion_g: portionG,
        calories:  0,
        protein_g: 0,
        carbs_g:   0,
        fat_g:     0,
        source:    'failed',
        resolved:  false,
    };
}

/**
 * Aggregate semua resolved items → satu result object
 * @private
 */
function _aggregateResults(resolvedItems, description, originalItems, geminiParse = null) {
    const total = resolvedItems.reduce((acc, item) => ({
        calories:  acc.calories  + (item.calories  || 0),
        protein_g: acc.protein_g + (item.protein_g || 0),
        carbs_g:   acc.carbs_g   + (item.carbs_g   || 0),
        fat_g:     acc.fat_g     + (item.fat_g     || 0),
    }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

    // Hitung coverage dan sumber data dominan
    const resolvedCount = resolvedItems.filter(i => i.resolved).length;
    const totalCount    = resolvedItems.length;

    // Tentukan data_source berdasarkan sumber yang paling banyak dipakai
    const sourceCounts = {};
    for (const item of resolvedItems) {
        if (item.resolved) {
            sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
        }
    }
    const dominantSource = Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'failed';

    // Confidence: kalau ada gemini_estimate di chain, turunkan confidence
    const hasGeminiEstimate = resolvedItems.some(i => i.source === 'gemini_estimate');
    const hasFailed         = resolvedItems.some(i => !i.resolved);
    const confidence = hasFailed
        ? 'low'
        : hasGeminiEstimate
            ? 'low'
            : resolvedCount === totalCount ? 'high' : 'medium';

    // Bangun human-readable resolver summary
    const resolverSummary = resolvedItems
        .map(i => `${i.name}(${i.source})`)
        .join(', ');

    return {
        is_food:          true,
        food_description: description || resolvedItems.map(i => i.name).join(', '),
        food_items:       originalItems,
        calories:         Math.round(total.calories),
        protein_g:        parseFloat(total.protein_g.toFixed(1)),
        carbs_g:          parseFloat(total.carbs_g.toFixed(1)),
        fat_g:            parseFloat(total.fat_g.toFixed(1)),
        confidence,
        data_source:      _buildDataSource(sourceCounts, resolvedCount, totalCount),
        resolver_items:   resolvedItems,
        resolver_summary: resolverSummary,
        coverage:         `${resolvedCount}/${totalCount}`,
        // Teruskan gemini_raw kalau ada — untuk debug / disimpan di DB
        gemini_raw:       geminiParse?.gemini_raw || null,
        notes:            geminiParse?.notes || '',
    };
}

/**
 * Bangun data_source label yang informatif untuk badge di Telegram
 * @private
 */
function _buildDataSource(sourceCounts, resolvedCount, totalCount) {
    const sources = Object.keys(sourceCounts);

    if (sources.length === 0) return 'failed';
    if (sources.length === 1) return sources[0];

    // Multiple sources — urutkan berdasarkan prioritas kualitas
    const priority = ['indonesian_dataset', 'usda', 'openfoodfacts', 'cache', 'gemini_estimate'];
    const sorted   = sources.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));

    if (sorted[0] === 'cache') return 'cache_mixed';
    return `${sorted[0]}_mixed`;
}

function _emptyResult(description) {
    return {
        is_food:          false,
        food_description: description,
        calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
        data_source: 'none',
    };
}

// ─── INTERNAL: ASYNC CACHE HELPER ────────────────────────────

/**
 * Simpan ke cache tanpa blocking — error diabaikan
 * @private
 */
function _cacheAsync(cacheKey, foodName, per100g, dataSource, confidence) {
    cache.set(cacheKey, foodName, per100g, dataSource, confidence)
        .catch(err => console.error('[Resolver] cache async error:', err.message));
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
    resolveFromText,
    resolveFromImage,
    resolveItems,
};