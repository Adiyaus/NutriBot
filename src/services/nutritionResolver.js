// ============================================================
// src/services/nutritionResolver.js — REVISED v2
// Orkestrasi fallback chain + Realistic Estimation Pipeline
//
// PIPELINE BARU (per food item):
//   1. normalizeFood()          → canonical name + cache key
//   2. nutritionCache.get()     → Supabase cache (fastest)
//   3. findFood() local dataset → dataset Indonesia (no network)
//   4. usda.searchFood()        → USDA FoodData Central API
//   5. off.searchByName()       → OpenFoodFacts API
//   6. gemini.estimateSingleFood() → Gemini AI (last resort)
//
//   Setelah nilai base per100g diperoleh dari chain di atas:
//   ↓ Layer: Cooking Adjustment  (cookingAdjustment.js)
//   ↓ Layer: Portion Scaling     (portionScaling.js)
//   ↓ Layer: Calorie Range Gen.  (calorieRangeGenerator.js)
//   ↓ Layer: Confidence Scoring  (confidenceScorer.js)
//
// PERUBAHAN DARI v1:
//   + Cooking method detection + multiplier (tidak hanya Gemini estimate)
//   + Portion scaling untuk kompensasi Gemini underestimate
//   + Output berupa range (conservative / likely / upper)
//   + Invisible calorie estimation (sambal, kecap, dll)
//   + Confidence scoring yang lebih detail
//   + Dataset bias correction (TKPI/USDA → nilai realistis)
//   + Indonesian food floors (minimum kcal/100g)
//
// PUBLIC API (tidak berubah, backward compatible):
//   resolveFromText(foodText)          → buat /catat
//   resolveFromImage(imageBuffer, ctx) → buat foto
//   resolveItems(foodItems)            → buat manual input array
// ============================================================

const { normalizeFood, buildSearchQueries } = require('../utils/normalizeFood');
const { applyGeminiBias }                   = require('../utils/geminicaloriebias');
const cache   = require('./nutritionCache');
const usda    = require('./usda');
const off     = require('./openfoodfacts');
const gemini  = require('./gemini');

// ── New engine layers ─────────────────────────────────────────
const { applyCookingAdjustment }          = require('../engine/cookingAdjustment');
const { applyPortionScaling,
        estimateInvisibleCalories }       = require('../engine/portionScaling');
const { generateMacroRange,
        formatCompact }                   = require('../engine/calorieRangeGenerator');
const { scoreConfidence,
        buildDisclaimerMessage }          = require('../engine/confidenceScore');

// Load dataset lokal secara defensive
let _findFood       = () => null;
let _datasetToNutri = () => null;
try {
    const dataset = require('../data/indonesianFoods');
    if (typeof dataset.findFood === 'function') {
        _findFood       = dataset.findFood;
        _datasetToNutri = dataset.toNutriFormat;
        console.log('[Resolver] Indonesian food dataset loaded ✅');
    } else {
        console.warn('[Resolver] indonesianFoods.js: findFood bukan function');
    }
} catch (err) {
    console.warn('[Resolver] indonesianFoods.js tidak ditemukan:', err.message);
}


// ─── MAIN ENTRY POINTS ────────────────────────────────────────

/**
 * Resolve nutrisi dari teks deskripsi makanan user (/catat)
 */
async function resolveFromText(foodText) {
    console.log(`[Resolver] resolveFromText: "${foodText}"`);

    let geminiParse;
    try {
        geminiParse = await gemini.estimateNutritionFromText(foodText);
    } catch (err) {
        console.error('[Resolver] Gemini parse gagal:', err.message);
        throw err;
    }

    if (!geminiParse.is_food) return geminiParse;
    return _resolveFromGeminiParse(geminiParse, '', { sourceType: 'text' });
}

/**
 * Resolve nutrisi dari foto makanan
 */
async function resolveFromImage(imageBuffer, userContext = '') {
    console.log(`[Resolver] resolveFromImage (context: "${userContext}")`);

    let geminiParse;
    try {
        geminiParse = await gemini.analyzeFoodImage(imageBuffer, 'image/jpeg', userContext);
    } catch (err) {
        console.error('[Resolver] Gemini vision gagal:', err.message);
        throw err;
    }

    if (!geminiParse.is_food) return geminiParse;
    return _resolveFromGeminiParse(geminiParse, userContext, { sourceType: 'image' });
}

/**
 * Resolve dari array food_items yang sudah ada
 */
async function resolveItems(foodItems, description = '') {
    if (!foodItems || foodItems.length === 0) {
        return _emptyResult(description);
    }

    const resolvedItems = await Promise.all(
        foodItems.map(item => _resolveOneItem(item, '', 'text'))
    );

    return _aggregateResults(resolvedItems, description, foodItems);
}


// ─── INTERNAL: RESOLVE FROM GEMINI PARSE ─────────────────────

async function _resolveFromGeminiParse(geminiParse, userContext = '', opts = {}) {
    const foodItems = geminiParse.food_items || [];

    if (foodItems.length === 0) {
        console.warn('[Resolver] is_food=true tapi food_items kosong');
        return {
            ...geminiParse,
            data_source: 'gemini_only',
            resolver_chain: 'no_items',
        };
    }

    const sourceType      = opts.sourceType || 'text';
    const geminiConfidence = geminiParse.confidence || 'medium';
    const mealDescription = geminiParse.food_description || '';

    const resolvedItems = await Promise.all(
        foodItems.map(item => _resolveOneItem(item, userContext, sourceType))
    );

    return _aggregateResults(
        resolvedItems,
        mealDescription,
        foodItems,
        geminiParse,
        { geminiConfidence, userContext, sourceType }
    );
}


// ─── INTERNAL: RESOLVE ONE ITEM (FULL PIPELINE) ──────────────

/**
 * Step 1–5: Fallback chain → base per100g
 * Step 6:   Cooking adjustment
 * Step 7:   Portion scaling
 * Step 8:   Scale adjusted values to actual portion
 *
 * @param {{ name: string, portion_g: number }} item
 * @param {string} userContext
 * @param {string} sourceType - 'image' | 'text'
 * @returns {ResolvedItem}
 */
async function _resolveOneItem(item, userContext = '', sourceType = 'text') {
    const rawPortionG = item.portion_g || 100;
    const { normalized, english, cacheKey } = normalizeFood(item.name);

    console.log(`[Resolver] Item: "${item.name}" → key="${cacheKey}", en="${english}"`);

    // ── STEP 1-5: Base Nutrition Chain ───────────────────────

    let per100g = null;
    let source  = 'failed';

    // Layer 1: Cache
    const cached = await cache.get(cacheKey);
    if (cached) {
        per100g = cached;
        source  = 'cache';
    }

    // Layer 2: Local Indonesian Dataset
    if (!per100g) {
        const localEntry = _findFood(normalized) || _findFood(english);
        if (localEntry) {
            per100g = _datasetToNutri(localEntry);
            source  = 'indonesian_dataset';
            _cacheAsync(cacheKey, localEntry.display, per100g, 'indonesian_dataset', 'high');
        }
    }

    // Layer 3: USDA
    if (!per100g) {
        const queries   = buildSearchQueries(normalized, english);
        const usdaResult = await _tryUSDA(queries, cacheKey);
        if (usdaResult) {
            per100g = usdaResult;
            source  = 'usda';
        }
    }

    // Layer 4: OpenFoodFacts
    if (!per100g) {
        const offResult = await _tryOpenFoodFacts(english, cacheKey);
        if (offResult) {
            per100g = offResult;
            source  = 'openfoodfacts';
        }
    }

    // Layer 5: Gemini Estimate (last resort)
    if (!per100g) {
        console.warn(`[Resolver] Fallback Gemini estimate: "${item.name}"`);
        const geminiResult = await _tryGeminiEstimate(item.name, rawPortionG, cacheKey);
        if (geminiResult) {
            per100g = geminiResult;
            source  = 'gemini_estimate';
        }
    }

    // Complete failure
    if (!per100g) {
        console.error(`[Resolver] Total gagal: "${item.name}"`);
        return _failedItem(item.name, rawPortionG);
    }

    // ── STEP 6: Cooking Adjustment ───────────────────────────
    // Detect metode masak dari nama, terapkan multiplier realistis

    const adjustedPer100g = applyCookingAdjustment(
        per100g,
        item.name,
        source,
        'mid'   // variant mid = most likely
    );

    // ── STEP 7: Portion Scaling ──────────────────────────────
    // Kompensasi Gemini underestimate untuk warung/restoran

    // Cek apakah user memberikan berat eksplisit (dari notes Gemini atau angka langsung)
    const hasExplicitPortion = _hasExplicitPortion(item);

    const portionResult = applyPortionScaling(
        rawPortionG,
        item.name,
        userContext,
        'mid',
        hasExplicitPortion
    );
    const finalPortionG = portionResult.adjusted_portion_g;

    // ── STEP 8: Scale to Actual Portion ──────────────────────

    const scaledResult = _scaleToResult(
        item.name,
        finalPortionG,
        adjustedPer100g,
        source,
        {
            original_portion_g:  rawPortionG,
            portion_context:     portionResult.context,
            portion_scale:       portionResult.scale_factor,
            cooking_adjustment:  adjustedPer100g.cooking_adjustment,
        }
    );

    return scaledResult;
}


// ─── INTERNAL: LAYER IMPLEMENTATIONS ─────────────────────────

async function _tryUSDA(queries, cacheKey) {
    for (const query of queries) {
        try {
            const results = await usda.searchFood(query, 1);
            if (!results.length) continue;

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
            console.warn(`[Resolver] USDA error "${query}":`, err.message);
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

        const rawPer100g = {
            calories_per100g: result.calories_per100g,
            protein_per100g:  result.protein_per100g  || 0,
            carbs_per100g:    result.carbs_per100g    || 0,
            fat_per100g:      result.fat_per100g      || 0,
            food_name:        result.food_name || foodName,
            data_source:      'gemini_estimate',
            confidence:       'low',
        };

        // Apply geminicaloriebias (tetap ada untuk gemini_estimate)
        const biasedPer100g = applyGeminiBias(rawPer100g, foodName);

        _cacheAsync(cacheKey, biasedPer100g.food_name, biasedPer100g, 'gemini_estimate', 'low');
        return biasedPer100g;

    } catch (err) {
        console.error('[Resolver] Gemini estimate error:', err.message);
        return null;
    }
}


// ─── INTERNAL: SCALE & AGGREGATE ─────────────────────────────

function _scaleToResult(name, portionG, per100g, source, meta = {}) {
    const scale = portionG / 100;
    return {
        name,
        portion_g:           portionG,
        original_portion_g:  meta.original_portion_g || portionG,
        calories:            Math.round((per100g.calories_per100g || 0) * scale),
        protein_g:           parseFloat(((per100g.protein_per100g || 0) * scale).toFixed(1)),
        carbs_g:             parseFloat(((per100g.carbs_per100g   || 0) * scale).toFixed(1)),
        fat_g:               parseFloat(((per100g.fat_per100g     || 0) * scale).toFixed(1)),
        source,
        food_name:           per100g.food_name || name,
        resolved:            true,
        // Metadata pipeline (untuk debug / detail view)
        _meta: {
            calories_per100g:   per100g.calories_per100g,
            portion_context:    meta.portion_context,
            portion_scale:      meta.portion_scale,
            cooking_adjustment: meta.cooking_adjustment,
        },
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
 * Aggregate semua resolved items → satu result object dengan range
 */
function _aggregateResults(resolvedItems, description, originalItems, geminiParse = null, opts = {}) {

    // ── Hitung totals (mid estimate) ──────────────────────────
    const total = resolvedItems.reduce((acc, item) => ({
        calories:  acc.calories  + (item.calories  || 0),
        protein_g: acc.protein_g + (item.protein_g || 0),
        carbs_g:   acc.carbs_g   + (item.carbs_g   || 0),
        fat_g:     acc.fat_g     + (item.fat_g     || 0),
    }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });

    // ── Source analysis ───────────────────────────────────────
    const resolvedCount = resolvedItems.filter(i => i.resolved).length;
    const totalCount    = resolvedItems.length;

    const sourceCounts = {};
    for (const item of resolvedItems) {
        if (item.resolved) {
            sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
        }
    }

    const dominantSource = Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'gemini_estimate';

    // ── Dominant cooking method ───────────────────────────────
    const cookingMethods = resolvedItems
        .filter(i => i.resolved && i._meta?.cooking_adjustment?.method)
        .map(i => i._meta.cooking_adjustment.method);

    const dominantMethod = _mostCommon(cookingMethods) || 'pan_fried';

    // ── Invisible calories ────────────────────────────────────
    const mealDesc = description || resolvedItems.map(i => i.name).join(' ');
    const invisible = estimateInvisibleCalories('', mealDesc);
    const invisibleKcal = invisible.extra_kcal;

    const adjustedTotal = {
        ...total,
        calories: Math.round(total.calories + invisibleKcal),
    };

    // ── Calorie Range ─────────────────────────────────────────
    const baseConfidence = _calcBaseConfidence(resolvedItems, opts.geminiConfidence);

    const macroRange = generateMacroRange(
        adjustedTotal,
        dominantSource,
        dominantMethod,
        baseConfidence
    );

    // ── Confidence Scoring ────────────────────────────────────
    const cookingDetection = resolvedItems[0]?._meta?.cooking_adjustment
        ? { confidence: resolvedItems[0]._meta.cooking_adjustment.method_confidence || 'medium' }
        : null;

    const confidenceResult = scoreConfidence({
        resolvedItems,
        dominantSource,
        geminiConfidence:      opts.geminiConfidence || 'medium',
        cookingDetection,
        portionDetection:      null,
        hasInvisibleCalories:  invisibleKcal > 0,
        userExplicitPortion:   false,
    });

    const disclaimer = buildDisclaimerMessage(confidenceResult);

    // ── Build resolver summary ────────────────────────────────
    const resolverSummary = resolvedItems
        .map(i => `${i.name}(${i.source})`)
        .join(', ');

    return {
        is_food:           true,
        food_description:  description || resolvedItems.map(i => i.name).join(', '),
        food_items:        originalItems,

        // ── Point estimates (most likely, untuk backward compat) ──
        calories:          macroRange.calories.likely,
        protein_g:         parseFloat(total.protein_g.toFixed(1)),
        carbs_g:           parseFloat(total.carbs_g.toFixed(1)),
        fat_g:             parseFloat(total.fat_g.toFixed(1)),

        // ── NEW: Calorie ranges ───────────────────────────────────
        calorie_range: {
            conservative: macroRange.calories.conservative,
            likely:       macroRange.calories.likely,
            upper:        macroRange.calories.upper,
            display:      macroRange.calories.display_text,
            uncertainty_pct: macroRange.calories.uncertainty_pct,
        },

        macro_range: {
            protein:  macroRange.protein_g,
            carbs:    macroRange.carbs_g,
            fat:      macroRange.fat_g,
        },

        // ── NEW: Cooking & portion metadata ──────────────────────
        cooking_method:    dominantMethod,
        invisible_calories: {
            amount:     invisibleKcal,
            components: invisible.components,
        },

        // ── NEW: Confidence detail ────────────────────────────────
        confidence:          confidenceResult.level,
        confidence_score:    confidenceResult.score,
        confidence_badge:    confidenceResult.display_badge,
        confidence_reasons:  confidenceResult.reasons,
        disclaimer,

        // ── Existing fields (unchanged) ───────────────────────────
        data_source:       _buildDataSource(sourceCounts, resolvedCount, totalCount),
        resolver_items:    resolvedItems,
        resolver_summary:  resolverSummary,
        coverage:          `${resolvedCount}/${totalCount}`,
        gemini_raw:        geminiParse?.gemini_raw || null,
        notes:             geminiParse?.notes || '',
    };
}


// ─── HELPERS ──────────────────────────────────────────────────

function _hasExplicitPortion(item) {
    // Kalau item punya notes tentang berat eksplisit dari user
    // (Gemini menyebut "user mentioned 300g" atau serupa)
    if (!item.notes) return false;
    return /\d+\s*(gram|g\b|kg)/.test(item.notes);
}

function _calcBaseConfidence(resolvedItems, geminiConfidence) {
    const hasGemini = resolvedItems.some(i => i.source === 'gemini_estimate');
    const hasFailed = resolvedItems.some(i => !i.resolved);

    if (hasFailed)        return 'low';
    if (hasGemini)        return 'low';
    if (geminiConfidence === 'low') return 'medium';
    return 'high';
}

function _mostCommon(arr) {
    if (!arr.length) return null;
    const counts = {};
    for (const v of arr) { counts[v] = (counts[v] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function _buildDataSource(sourceCounts, resolvedCount, totalCount) {
    const sources = Object.keys(sourceCounts);
    if (sources.length === 0) return 'failed';
    if (sources.length === 1) return sources[0];

    const priority = ['indonesian_dataset', 'usda', 'openfoodfacts', 'cache', 'gemini_estimate'];
    const sorted   = sources.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
    return sorted[0] === 'cache' ? 'cache_mixed' : `${sorted[0]}_mixed`;
}

function _emptyResult(description) {
    return {
        is_food:          false,
        food_description: description,
        calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
        data_source: 'none',
    };
}

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