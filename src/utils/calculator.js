// ============================================================
// src/utils/calculator.js
// Kalkulasi BMR & TDEE pakai rumus Mifflin-St Jeor
// ============================================================

require('dotenv').config();

const ACTIVITY_MULTIPLIERS = {
    sedentary:   1.2,
    light:       1.375,
    moderate:    1.55,
    active:      1.725,
    very_active: 1.9
};

const ACTIVITY_LABELS = {
    sedentary:   'Santai banget (jarang gerak)',
    light:       'Gerak dikit (1-3x olahraga/minggu)',
    moderate:    'Lumayan aktif (3-5x olahraga/minggu)',
    active:      'Aktif banget (6-7x olahraga/minggu)',
    very_active: 'Super aktif (atlet / kerja fisik)'
};

/**
 * Hitung BMR - Mifflin-St Jeor
 */
function calculateBMR(weightKg, heightCm, age, gender) {
    if (!weightKg || !heightCm || !age || !gender) {
        throw new Error('Data tidak lengkap buat hitung BMR');
    }
    let bmr;
    if (gender === 'pria') {
        bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5;
    } else {
        bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;
    }
    return Math.round(bmr);
}

/**
 * Hitung TDEE = BMR × activity multiplier
 */
function calculateTDEE(bmr, activityLevel) {
    const multiplier = ACTIVITY_MULTIPLIERS[activityLevel];
    if (!multiplier) throw new Error(`Activity level tidak valid: ${activityLevel}`);
    return Math.round(bmr * multiplier);
}

/**
 * Target kalori = TDEE - deficit (default 500 kkal)
 */
function calculateDailyGoal(tdee, deficit = parseInt(process.env.CALORIE_DEFICIT) || 500) {
    return Math.max(tdee - deficit, 1200); // minimum 1200 kkal
}

/**
 * Format ringkasan kalori buat dikirim ke Telegram
 */
function formatCalorieReport(bmr, tdee, dailyGoal, activityLevel) {
    const label = ACTIVITY_LABELS[activityLevel] || activityLevel;
    return (
        `🔢 *Hasil Kalkulasi Lo:*\n\n` +
        `📊 BMR: *${bmr} kkal/hari*\n` +
        `   _\\(kalori kalau rebahan doang\\)_\n\n` +
        `⚡ TDEE: *${tdee} kkal/hari*\n` +
        `   _\\(total sesuai aktivitas: ${label}\\)_\n\n` +
        `🎯 Target Lo: *${dailyGoal} kkal/hari*\n` +
        `   _\\(TDEE \\- 500 kkal → turun \\~0\\.5kg/minggu\\)_`
    );
}

/**
 * Parse input aktivitas dari berbagai format teks
 */
function parseActivityLevel(input) {
    const text = input.toLowerCase().trim();
    const mapping = {
        '1': 'sedentary', 'sedentary': 'sedentary', 'santai': 'sedentary',
        '2': 'light',     'light': 'light',          'ringan': 'light',
        '3': 'moderate',  'moderate': 'moderate',    'sedang': 'moderate',
        '4': 'active',    'active': 'active',        'aktif': 'active',
        '5': 'very_active','very_active': 'very_active','super': 'very_active'
    };
    return mapping[text] || null;
}

module.exports = {
    calculateBMR,
    calculateTDEE,
    calculateDailyGoal,
    formatCalorieReport,
    parseActivityLevel,
    ACTIVITY_LABELS
};