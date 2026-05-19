// ============================================================
// scripts/seed-cache.js
// Pre-populate nutrition_cache di Supabase dari local dataset
//
// Jalankan sekali setelah setup DB:
//   node scripts/seed-cache.js
//
// Manfaat:
//   - Cold start lebih cepat (gak perlu hit USDA/OFF untuk makanan umum)
//   - ~70 makanan Indonesia langsung tersedia di cache
// ============================================================

require('dotenv').config();
const { INDONESIAN_FOODS, toNutriFormat } = require('../src/data/indonesianFoods');
const { normalizeFood } = require('../src/utils/normalizeFood');
const cache = require('../src/services/nutritionCache');

async function seedCache() {
    console.log(`\n🌱 Seeding nutrition cache dari indonesianFoods dataset...`);
    console.log(`   Total entries: ${INDONESIAN_FOODS.length}\n`);

    let success = 0;
    let skipped = 0;
    let failed  = 0;

    for (const entry of INDONESIAN_FOODS) {
        // Ambil alias pertama sebagai primary name buat normalize
        const primaryName = entry.aliases[0];
        const { cacheKey } = normalizeFood(primaryName);

        if (!cacheKey) {
            console.warn(`  ⚠️  Skip: "${primaryName}" → cacheKey kosong`);
            skipped++;
            continue;
        }

        const per100g = toNutriFormat(entry);
        const ok = await cache.set(
            cacheKey,
            entry.display,
            per100g,
            'indonesian_dataset',
            'high'
        );

        if (ok) {
            console.log(`  ✅ ${cacheKey.padEnd(30)} → ${entry.per100g.calories} kcal/100g`);
            success++;
        } else {
            console.error(`  ❌ Gagal seed: ${cacheKey}`);
            failed++;
        }

        // Rate limit Supabase: jangan terlalu cepat
        await new Promise(r => setTimeout(r, 50));
    }

    console.log(`\n📊 Seed selesai:`);
    console.log(`   ✅ Berhasil: ${success}`);
    console.log(`   ⚠️  Skipped:  ${skipped}`);
    console.log(`   ❌ Gagal:    ${failed}`);
    console.log(`\nCache siap dipakai! 🚀\n`);
}

seedCache().catch(err => {
    console.error('Seed error:', err.message);
    process.exit(1);
});