-- ============================================================
-- SCHEMA DATABASE: Telegram Nutrition Bot
-- Setup: supabase.com → SQL Editor → paste & Run
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    telegram_id         BIGINT UNIQUE NOT NULL,        -- ID unik user dari Telegram
    username            VARCHAR(100),                   -- @username Telegram (bisa null)
    name                VARCHAR(100),                   -- nama panggilan user
    age                 INTEGER,
    gender              VARCHAR(10) CHECK (gender IN ('pria', 'wanita')),
    height_cm           DECIMAL(5,2),
    weight_kg           DECIMAL(5,2),
    activity_level      VARCHAR(20) CHECK (activity_level IN (
                            'sedentary', 'light', 'moderate', 'active', 'very_active'
                        )),
    bmr                 DECIMAL(8,2),
    tdee                DECIMAL(8,2),
    daily_calorie_goal  DECIMAL(8,2),
    registration_step   VARCHAR(30) DEFAULT 'idle',    -- state machine posisi registrasi
    is_registered       BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS food_logs (
    id              SERIAL PRIMARY KEY,
    telegram_id     BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    log_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    food_description TEXT,
    calories        DECIMAL(8,2) DEFAULT 0,
    protein_g       DECIMAL(8,2) DEFAULT 0,
    carbs_g         DECIMAL(8,2) DEFAULT 0,
    fat_g           DECIMAL(8,2) DEFAULT 0,
    gemini_raw      TEXT,
    logged_at       TIMESTAMP DEFAULT NOW()
);

-- Index buat performa query
CREATE INDEX IF NOT EXISTS idx_food_logs_tg_date ON food_logs(telegram_id, log_date);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- View: total nutrisi harian per user
CREATE OR REPLACE VIEW daily_summary AS
    SELECT
        telegram_id,
        log_date,
        SUM(calories)  AS total_calories,
        SUM(protein_g) AS total_protein,
        SUM(carbs_g)   AS total_carbs,
        SUM(fat_g)     AS total_fat,
        COUNT(*)       AS meal_count
    FROM food_logs
    GROUP BY telegram_id, log_date;
