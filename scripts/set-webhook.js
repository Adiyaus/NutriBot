// ============================================================
// scripts/set-webhook.js
// Jalankan sekali setelah deploy: node scripts/set-webhook.js
// ============================================================

require('dotenv').config();
const https = require('https');

const TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const VERCEL_URL  = process.env.VERCEL_URL; // contoh: nutribot.vercel.app

if (!TOKEN || !VERCEL_URL) {
    console.error('❌ Set TELEGRAM_BOT_TOKEN dan VERCEL_URL di .env dulu!');
    process.exit(1);
}

const webhookUrl = `https://${VERCEL_URL}/api/webhook`;
const apiUrl = `https://api.telegram.org/bot${TOKEN}/setWebhook?url=${webhookUrl}&drop_pending_updates=true`;

console.log(`\n🔗 Setting webhook ke: ${webhookUrl}\n`);

https.get(apiUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const result = JSON.parse(data);
        if (result.ok) {
            console.log('✅ Webhook berhasil di-set!');
            console.log(`   URL: ${webhookUrl}`);
        } else {
            console.error('❌ Gagal set webhook:', result.description);
        }
    });
}).on('error', err => {
    console.error('❌ Request error:', err.message);
});
