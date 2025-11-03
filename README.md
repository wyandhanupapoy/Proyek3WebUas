WA Service (wwebjs + TypeORM + Redis)

Fitur utama:
- WhatsApp Web Multi-Device (wwebjs) dengan multi clientId (LocalAuth)
- Database TypeORM (SQLite default) untuk config, akun WA, job pesan, dan broadcast
- Status WA (READY/QR/DISCONNECTED/AUTH_FAILURE) direkam ke database
- Pengiriman pesan via job queue (BullMQ/Redis)
- Backoff jadwal retry pakai deret Fibonacci
- Broadcast kirim ke banyak penerima memakai mekanisme job yang sama

Persiapan:
1) Instal dependency
   npm install

2) Konfigurasi environment (opsional): salin .env.sample ke .env dan sesuaikan
   - PORT, REDIS_URL, SQLITE_PATH, WA_CLIENT_IDS
   - SCHEDULER_BASE_DELAY_MS, SCHEDULER_MAX_ATTEMPTS

3) Jalankan server
   npm run start

Alur penggunaan:
- Start client WA: POST /accounts/:clientId/start
- Ambil QR untuk scan: GET /accounts/:clientId/qr
  Scan QR dengan aplikasi WhatsApp di ponsel Anda.
- Cek status akun: GET /accounts

Auto reconnect sessions saat start:
- Service otomatis mendeteksi folder LocalAuth (default: `.wwebjs_auth` atau `WWEBJS_DATA_PATH`/`SESSIONS_DIR`).
- Semua session yang ditemukan akan di-start ulang (reconnect) saat aplikasi boot.
- Anda juga bisa menambahkan `WA_CLIENT_IDS` untuk memaksa start client tertentu.

Kirim pesan tunggal:
POST /messages
Body JSON:
{
  "clientId": "mywa1",
  "to": "62812xxxxxxx",
  "text": "Halo dari WA Bot",
  "maxAttempts": 8 // opsional
}

Broadcast:
POST /broadcasts
Body JSON:
{
  "clientId": "mywa1",
  "name": "Promo September",
  "text": "Diskon 20% minggu ini!",
  "recipients": ["62812xxx", "62813xxx"]
}

Konfigurasi tersimpan di DB:
- Gunakan endpoint untuk set/get config agar dinamis:
  - POST /config { "key": "SCHEDULER_BASE_DELAY_MS", "value": "1000" }
  - GET /config/SCHEDULER_BASE_DELAY_MS

Catatan implementasi:
- Penyimpanan sesi wwebjs menggunakan LocalAuth (folder lokal), sedangkan metadata akun & status disimpan di database.
- Penjadwalan retry memakai deret Fibonacci (1,1,2,3,5,...) x baseDelay (ms).
- Job queue memakai BullMQ + Redis. Worker memproses pengiriman dan menjadwalkan retry manual bila gagal hingga maxAttempts.
 - Puppeteer: disarankan set `PUPPETEER_EXECUTABLE_PATH` di `.env` agar memakai Chrome/Chromium lokal dan menghindari unduhan Chromium. Anda juga bisa atur `PUPPETEER_LAUNCH_TIMEOUT_MS`.
 - Reconnect: atur lokasi folder session dengan `WWEBJS_DATA_PATH` atau `SESSIONS_DIR` (default `.wwebjs_auth`).

Struktur endpoint ringkas:
- GET  /health
- GET  /accounts
- POST /accounts/:clientId/start
- POST /accounts/:clientId/reconnect
- POST /sessions
- POST /sessions/:clientId/reconnect
- GET  /accounts/:clientId/qr
- POST /messages
- GET  /jobs/:id
- POST /broadcasts
- GET  /broadcasts/:id
- DELETE /accounts/:clientId
- DELETE /sessions/:clientId

Pengembangan:
- Kode sumber utama berada di folder src/.
- Entitas TypeORM: src/entities/*
- Worker & Queue: src/queue/*
- Manajer WhatsApp Client: src/whatsapp/clientManager.js
- HTTP Server: src/server.js

Dokumentasi API (Swagger UI)
- OpenAPI JSON: GET /openapi.json
- Swagger UI:   GET /docs

Keamanan API
- Semua endpoint (kecuali `/health`, `/docs`, `/openapi.json`) memerlukan API key.
- Set `API_KEY` di `.env` atau via endpoint `/config` (key: `API_KEY`).
- Sertakan header: `x-api-key: <API_KEY>` pada setiap request.

Membuat Session WhatsApp
- Endpoint: POST /sessions
- Body contoh:
  {
    "clientId": "mywa1",
    "dataPath": "sessions",           // opsional, default dari env WWEBJS_DATA_PATH/SESSIONS_DIR
    "puppeteer": { "headless": true } // opsional
  }
  Respon akan berisi row akun (status/QR terakhir bila ada). QR juga bisa diambil via GET /accounts/:clientId/qr.

Kebijakan QR & Reconnect
- Jika status akun = DISCONNECTED, endpoint `/accounts/{clientId}/start` dan `/sessions` mengembalikan 409 (tidak auto-generate QR).
- Untuk memicu generate QR, gunakan endpoint khusus: `POST /accounts/{clientId}/reconnect` (atau alias `POST /sessions/{clientId}/reconnect`).
- Aplikasi juga tidak akan auto-reconnect atau auto-generate QR saat boot untuk akun yang DISCONNECTED.

Auto-purge saat disconnect
- Ketika client WA memicu event `disconnected`, service akan:
  - Mematikan client bila masih aktif.
  - Menghapus folder LocalAuth untuk session tersebut.
  - Menghapus row akun dari database.
  Dengan demikian, tidak akan ada QR yang di-generate otomatis setelah disconnect.

## Docker

- Build dan jalankan dengan Redis terintegrasi:
  - `docker compose up -d --build`
  - Server berjalan di `http://localhost:3100`

- File penting:
  - `Dockerfile` — image Node.js + Chromium (untuk whatsapp-web.js/puppeteer)
  - `docker-compose.yml` — layanan `app` dan `redis` + volume persistensi

- Environment yang dipakai di container:
  - `REDIS_URL=redis://redis:6379` (override dari `docker-compose.yml`)
  - `SQLITE_PATH=/data/db.sqlite` (DB SQLite di volume)
  - `WWEBJS_DATA_PATH=/data/sessions` (folder sesi LocalAuth di volume)
  - `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
  - Nilai lain mengikuti `.env` (via `env_file`), misal `PORT`, `API_KEY`, `SCHEDULER_*`.

- Volume:
  - `app-data` untuk `/data` (SQLite + sesi WhatsApp)
  - `redis-data` untuk data Redis

- Tips:
  - Pastikan header `x-api-key` sesuai `API_KEY` di `.env` saat akses endpoint.
  - Untuk melihat log: `docker compose logs -f app`
  - Hentikan: `docker compose down` (data tetap tersimpan di volume)
