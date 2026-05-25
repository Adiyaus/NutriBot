# NutriBot: AI-Powered Telegram Nutrition Tracker Bot 🤖🍏

NutriBot adalah sistem asisten pelacak nutrisi dan kalori harian pintar berbasis bot Telegram yang dibangun di atas runtime Node.js. Dengan memanfaatkan multimodal AI **Gemini 2.5 Flash**, bot ini mampu mengeliminasi proses pencatatan konvensional yang repetitif dan kaku menjadi interaksi alami berbasis teks dan gambar.

---

## 📝 1. Project Overview

### 1.1 Latar Belakang & Permasalahan
Dalam menjaga pola hidup sehat atau menjalankan program diet (seperti *cutting* atau *bulking*), pencatatan *macronutrients* (Kalori, Protein, Karbohidrat, Lemak) harian adalah hal yang wajib dilakukan. Namun, aplikasi pelacak nutrisi konvensional yang ada di pasar saat ini memiliki tingkat *friction* yang tinggi bagi *user*. *User* diwajibkan mencari nama makanan secara spesifik satu per satu, mengira-ngira berat gramasi secara manual, dan mengisi form yang kaku. Kompleksitas ini sering kali menyebabkan penurunan retensi *user* (*user churn*) karena proses pencatatan dirasa terlalu menyita waktu.

### 1.2 Solusi yang Ditawarkan
NutriBot hadir sebagai solusi alternatif yang berfokus pada fleksibilitas dan kenyamanan interaksi (*frictionless tracking*). Berjalan di platform Telegram, bot ini bertindak sebagai asisten pribadi yang selalu siap sedia. Pengguna cukup:
* **Mengirimkan foto makanan** mereka secara langsung, atau
* **Menuliskan menu makanan** dalam bahasa sehari-hari (NLP).

Sistem di balik NutriBot akan secara otomatis mengurai komponen makanan, melakukan kalkulasi estimasi porsi, mencocokkannya dengan basis data pangan lokal maupun internasional, dan langsung mencatatnya ke dalam profil nutrisi harian pengguna tanpa perlu mengisi form manual yang rumit.

### 1.3 Target & Batasan Sistem
* **Automated Calorie Counter:** Estimasi kilokalori (kcal) dan komposisi makro harian yang presisi.
* **Personalized Analytics:** Kalkulasi batas kalori harian personal berdasarkan rumus BMR (Harris-Benedict) dan indeks aktivitas TDEE.
* **Contextual AI Coach:** Menyediakan fitur konsultasi kesehatan yang memahami kondisi fisik aktual pengguna dan sisa kuota kalori hariannya.

---

## 🧠 2. Desain Arsitektur & Pola Perangkat Lunak

Proyek ini tidak sekadar melakukan pemanggilan API secara mentah, melainkan menerapkan pola perancangan perangkat lunak (*software design patterns*) untuk menjamin efisiensi resource dan akurasi data.

### 2.1 Chain of Responsibility Pattern (`nutritionResolver.js`)
Untuk menghemat penggunaan kuota token API Gemini sekaligus mempercepat waktu respon (*low latency*), pencarian informasi nutrisi teks/NLP dilakukan secara berjenjang menggunakan pola *Chain of Responsibility*:

```text
[Input Teks Pengguna] 
         │
         ▼
 ┌───────────────┐      Found?     ┌──────────────────────┐
 │ 1. Local Cache│ ──────────────> │ Kembalikan Data      │
 └───────────────┘                 └──────────────────────┘
         │ Not Found
         ▼
 ┌───────────────┐      Found?     ┌──────────────────────┐
 │2. Local Dataset│ ──────────────> │ Normalisasi & Return │ (indonesianFoods.js)
 └───────────────┘                 └──────────────────────┘
         │ Not Found
         ▼
 ┌───────────────┐      Found?     ┌──────────────────────┐
 │3. External API│ ──────────────> │ Ambil Makro & Return │ (USDA / OpenFoodFacts)
 └───────────────┘                 └──────────────────────┘
         │ Not Found
         ▼
 ┌───────────────┐
 │ 4. Gemini AI  │ ──────────────> [Analisis NLP Terakhir & Caching Otomatis]
 └───────────────┘
```

### 2.2 Finite State Machine (FSM) dalam Alur Multimodal Vision
Ketika pengguna mengirimkan foto, bot tidak langsung mengirimkannya ke API Gemini. Sistem akan mengaktifkan *State Machine* untuk meminta konteks tambahan dari pengguna:
1. **State: IDLE** -> Pengguna mengirimkan foto makanan.
2. **State: WAITING_FOR_CONTEXT** -> Bot mengunci input dan memunculkan tombol pilihan. Pengguna bisa mengetik teks detail porsi (misal: "porsi kuli", "gulai ayamnya bagian dada") atau menekan tombol `⏩ Skip Konteks`.
3. **State: PROCESSING** -> Gambar + Konteks digabungkan sebagai *multimodal prompt* menuju Gemini Vision API.
4. **State: IDLE** -> Hasil ditampilkan, data disimpan ke database, kunci state dilepas.

---

## 🚀 3. Fitur Utama Sistem

* **Vision-Based Food Analysis (📸 Multimodal Vision)**
  * Menganalisis foto makanan menggunakan Gemini Vision API secara instan.
  * Auto-logging kalori, protein, karbohidrat, dan lemak langsung ke database.
* **Natural Language Logging (`/catat`)**
  * Pencatatan makanan via teks menggunakan pemrosesan bahasa alami (NLP).
  * Contoh pencatatan: `/catat indomie goreng 1 bungkus + telur dada` atau `/catat nasi goreng ayam gulai`.
* **Manual Macro Input (`/input`)**
  * Template cepat memasukkan data makro nutrisi secara manual bila mengetahui informasi gizi pastinya.
  * Format instan: `/input [Nama Makanan] | [Kalori] [Protein] [Karbo] [Lemak]`.
* **Interactive AI Health Coach (`/tanya` & `/lupain`)**
  * Konsultasi diet pribadi berbasis profil fisik (BMR, TDEE, target berat) dan asupan aktual pengguna.
  * Menggunakan *In-Memory Conversation History* (hingga 10 pesan terakhir) untuk kontekstual dialog yang natural.
* **Saved Menus System (`/menu`)**
  * Menyimpan hasil analisis makanan ke daftar menu favorit (`💾 Simpan ke Menu`).
  * Mendukung sistem halaman (*pagination*) dan pencatatan ulang instan tanpa perlu analisis ulang.
* **Interactive Smart Status Bar (`/status`, `/laporan`, `/streak`)**
  * Progres harian diwakili oleh *progress bar* dinamis (`██████░░░░`).
  * Indikator status berbasis kode warna emonji (🔴 Over budget, 🟡 Sisa mepet, 🟠 Warning 80%+, 🟢 On track).
  * Pelacakan *streak* kontinuitas log harian guna meningkatkan kedisiplinan pengguna.
* **Koreksi Data Instan (`/adjust` & `/hapus`)**
  * Memperbarui deskripsi atau memodifikasi angka kalori/makro dari log terakhir secara instan.
  * Antarmuka inline untuk menghapus log spesifik pada hari berjalan jika terjadi kesalahan pencatatan.

---

## 🛠️ 4. Tech Stack & Dependensi

Proyek ini dibangun di atas ekosistem JavaScript modern dengan dependensi utama sebagai berikut:

* **Runtime & Framework:** Node.js (v18+) & [Telegraf.js (v4)](https://github.com/telegraf/telegraf) sebagai Telegram Bot framework.
* **Artificial Intelligence:** `@google/genai` (v1.0.0) memanfaatkan model Gemini 2.5 Flash untuk analisis multimodal dan teks.
* **Database & Persistence:** [@supabase/supabase-js](https://supabase.com/) berbasis PostgreSQL untuk manajemen relasional data pengguna, profil, dan *food logs*.
* **Scheduling:** `node-cron` untuk pembersihan otomatis memori/state harian (*Daily Memory Reset*) setiap tengah malam.
* **Networking:** `axios` untuk kebutuhan request HTTP eksternal.

---

## 📂 5. Struktur Direktori Proyek

```text
NutriBot/
├── api/
│   ├── cron-reminder.js       # Target endpoint untuk tugas terjadwal / cron
│   └── webhook.js             # Webhook endpoint untuk integrasi Telegram serverless
├── scripts/
│   ├── seed-cache.js          # Skrip seeding awal cache nutrisi lokal
│   └── set-webhook.js         # Skrip otomatisasi registrasi Webhook Bot ke Telegram API
├── src/
│   ├── config/
│   │   └── realisticMultipliers.js # Pengali porsi & penyesuaian kalori realistik
│   ├── data/
│   │   └── indonesianFoods.js # Dataset lokal tabel komposisi pangan Indonesia (TKPI)
│   ├── engine/                # Logika kalkulasi, pembobotan, dan penyesuaian porsi
│   ├── handlers/
│   │   └── messageHandler.js  # Core handler untuk seluruh command, teks, foto, dan callback query
│   ├── services/
│   │   ├── database.js        # Abstraksi koneksi dan query data ke Supabase
│   │   ├── gemini.js          # Integrasi API Gemini (Vision & Text)
│   │   └── nutritionResolver.js # Chain of Responsibility pencarian database nutrisi
│   ├── utils/
│   │   └── calculator.js      # Rumus BMR (Harris-Benedict), TDEE, dan formatting pesan
│   └── index.js               # Entry point aplikasi & inisialisasi server HTTP Health Check
├── Procfile                   # Konfigurasi proses untuk deployment Heroku/Dokku
├── schema.sql                 # Skema DDL Database PostgreSQL / Supabase
├── vercel.json                # Konfigurasi deployment serverless untuk Vercel
├── package.json               # Manifest proyek dan definisi skrip npm
└── README.md                  # Dokumentasi proyek
```

---

## ⚙️ 6. Konfigurasi Environment Variables (`.env`)

Buat berkas `.env` pada direktori akar proyek Anda dan konfigurasikan variabel lingkungan berikut:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
BOT_NAME=NutriBot

# Database (Supabase Configuration)
SUPABASE_URL=https://your_project_id.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_public_key_here

# AI Service Configuration
GEMINI_API_KEY=your_google_gemini_api_key_here

# Application/Server Configuration
PORT=3000

# Diet Engine Configuration (Optional Defaults)
CALORIE_DEFICIT=500
```

---

## 🚀 7. Instalasi & Langkah Memulai (Local Development)

### 7.1 Kloning Repositori & Instalasi Dependensi
```bash
git clone <repository-url>
cd NutriBot
npm install
```

### 7.2 Migrasi Database
Eksekusi seluruh statemen DDL yang berada di dalam file `schema.sql` pada SQL Editor di dasbor Supabase Anda untuk membentuk tabel-tabel pengguna (`users`), log makanan (`food_logs`), dan konfigurasi menu (`saved_menus`).

### 7.3 Jalankan Aplikasi
* **Mode Produksi:**
  ```bash
  npm start
  ```
* **Mode Pengembangan (menggunakan Nodemon):**
  ```bash
  npm run dev
  ```

---

## 🌐 8. Deployment & Manajemen Uptime

### 8.1 Penanganan HTTP Health Check (Render / Railway)
Aplikasi ini menyertakan server HTTP internal (via modul bawaan `http`) pada `src/index.js` yang mendengarkan request pada port yang ditentukan (`PORT` atau default `3000`).
* Endpoint `/` dan `/health` akan membalas dengan status JSON `ok`, informasi *uptime*, serta stempel waktu (*timestamp*).
* Komponen ini krusial untuk mencegah kegagalan deployment pada platform seperti Render yang mewajibkan adanya port aktif, sekaligus berfungsi sebagai target ping berkala menggunakan layanan seperti **UptimeRobot** agar bot tidak memasuki mode *sleep* (menjaga *cold start* tetap minimal).

### 8.2 Registrasi Webhook (Opsional)
Jika Anda ingin menerapkan arsitektur berbasis Webhook alih-alih *Long Polling* (`bot.launch()`), jalankan skrip pembantu untuk mendaftarkan URL HTTPS deployment Anda ke server Telegram:

```bash
npm run setup-webhook
```

---

## 🕹️ 9. Daftar Perintah (Command Reference)

| Perintah | Deskripsi |
| :--- | :--- |
| `/mulai` / `/start` | Menginisialisasi proses registrasi profil pengguna baru atau menyapa kembali pengguna lama. |
| `/help` | Menampilkan seluruh daftar perintah yang tersedia beserta petunjuk interaksi bot. |
| `/status` | Menyajikan ringkasan makro harian beserta daftar makanan yang dikonsumsi hari ini. |
| `/laporan` | Menyusun grafik ringkasan dan evaluasi performa kalori harian selama 7 hari terakhir. |
| `/streak` | Memeriksa tingkat konsistensi logging harian berturut-turut untuk menjaga kedisiplinan pengguna. |
| `/target [kg]` | Menetapkan target berat badan ideal sekaligus menghitung estimasi durasi pencapaian target. |
| `/remind [HH:MM]`| Mengatur jam pengingat harian otomatis terintegrasi dengan penjadwalan sistem. |
| `/menu` | Membuka repositori menu makanan yang disimpan guna pencatatan kilat. |
| `/catat [teks]` | Melakukan pencatatan makanan berbasis teks secara instan menggunakan estimasi pintar AI. |
| `/input` | Memasukkan rincian nutrisi secara manual, baik via satu baris template maupun terpandu. |
| `/tanya [teks]` | Melakukan interaksi tanya jawab langsung dengan Coach NutriBot AI terkait program diet. |
| `/lupain` | Membersihkan memori/riwayat dialog dengan Coach AI untuk memulai sesi konsultasi baru. |
| `/profil` | Melihat visualisasi data personalia pengguna, BMR, TDEE, dan opsi pembaruan profil. |
| `/reset` | Menghapus seluruh riwayat rekaman log makanan yang telah dicatat pada hari berjalan. |
| `/hapus` | Menampilkan menu sukses berbasis tombol untuk menghapus satu log makanan spesifik. |
| `/adjust` | Memberikan akses koreksi instan pada nama komponen pangan atau kuantitas nilai gizi log terakhir. |

---

## 🔒 10. Manajemen Memori Otomatis
Bot ini menerapkan strategi pembersihan memori internal (`resetDailyMemory`) yang dipicu melalui *cron job* harian. Fungsi ini akan membersihkan seluruh pemetaan *in-memory runtime state* seperti pelacak status edit, riwayat dialog chat coach, serta referensi log ID terakhir tepat pada tengah malam agar tidak terjadi tumpang tindih logika antar-hari pencatatan.
