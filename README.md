# CodeShare Node.js 22+

CodeShare versi ini adalah rewrite penuh dari backend FastAPI/Python ke Node.js 22+ dengan Express, Nunjucks, WebSocket, dan penyimpanan JSON yang tetap kompatibel dengan struktur data lama.

## Yang berubah

- Backend Python/FastAPI dihapus dan diganti Node.js 22+
- Port default tetap `8700`
- UI dirework dengan CSS/JavaScript lokal tanpa Tailwind CDN
- JSON file memakai async I/O, atomic write, dan cache berdasarkan `mtime`
- WebSocket realtime tetap tersedia
- JWT + bcrypt tetap dipakai sehingga hash bcrypt lama tetap kompatibel
- Follow system yang sebelumnya dipanggil UI tetapi route-nya tidak ada sekarang sudah diimplementasikan
- `feed.html` yang sebelumnya dirujuk tetapi tidak ada sekarang tersedia
- Admin dashboard digabung ke dashboard utama dan tidak lagi bergantung pada `dashboardadmin.html` yang hilang
- Rate limit untuk API/auth/runner
- Helmet + compression
- Upload limit 5 MB
- Search dan halaman users menghindari repeated full-directory scan per user

## Requirement

- Node.js `22+`
- npm `10+`

Cek versi:

```bash
node -v
npm -v
```

## Install

```bash
cp .env.example .env
npm install
npm start
```

Buka:

```text
http://localhost:8700
```

Development mode:

```bash
npm run dev
```

## PM2

```bash
npm install -g pm2
npm install
pm2 start ecosystem.config.cjs
pm2 save
```

Log:

```bash
pm2 logs codeshare
```

Restart:

```bash
pm2 restart codeshare
```

## Docker

```bash
docker build -t codeshare-node22 .
docker run -d \
  --name codeshare \
  -p 8700:8700 \
  --env-file .env \
  -v codeshare-data:/app/data \
  codeshare-node22
```

## Environment

Lihat `.env.example`.

Yang paling penting:

```env
PORT=8700
HOST=0.0.0.0
NODE_ENV=production
SECRET_KEY=change-this-to-a-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=30
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ADMIN_EMAIL=admin@codeshare.local
```

Ganti `SECRET_KEY` dan password admin sebelum production.

### Google OAuth

Isi:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://domain-kamu.com/auth/google/callback
```

Jika belum diisi, tombol Google tetap ada tetapi server akan mengarahkan kembali ke login dengan status bahwa OAuth belum dikonfigurasi.

## Admin default

Saat `data/users/<ADMIN_USERNAME>.json` belum ada, server membuat admin otomatis dari environment:

```text
username: admin
password: admin123
```

Credential ini hanya fallback awal dan harus diganti untuk deployment publik.

## Migrasi data dari versi Python

Struktur data tetap dipertahankan:

```text
data/
├── users/
├── codes/
├── threads/
├── notifications/
└── profile_pictures/
```

Kalau versi Python lama sudah memiliki folder `data`, copy folder tersebut ke root project Node.js ini sebelum start.

Contoh:

```bash
cp -a /path/codeshare-python/data/. ./data/
npm start
```

Password user lama tetap dapat diverifikasi karena bcrypt hash dari versi Python kompatibel dengan `bcryptjs`.

## Endpoint utama

### Pages

- `GET /`
- `GET /login`
- `GET /signup`
- `GET /create`
- `GET /dashboard`
- `GET /feed`
- `GET /users`
- `GET /user/:username`
- `GET /paste/:pasteId`
- `GET /edit/:pasteId`

### Auth

- `POST /api/signup`
- `POST /api/login`
- `GET /api/me`
- `GET /auth/google`
- `GET /auth/google/callback`

### Paste

- `POST /api/paste`
- `PUT /api/paste/:pasteId`
- `DELETE /api/paste/:pasteId`
- `GET /api/paste/:pasteId/edit`
- `GET /api/paste/:pasteId/stats`
- `GET /api/public-pastes`
- `GET /api/search`

### Social

- `POST /api/thread`
- `POST /api/follow/:username`
- `GET /api/follow/:username/status`
- `GET /api/feed`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`

### Profile

- `POST /api/profile/update`
- `POST /api/profile-picture`

### Admin

- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/admin/pastes`
- `POST /api/admin/verify-user`
- `POST /api/admin/promote-user`
- `DELETE /api/admin/user/:username`
- `DELETE /api/admin/paste/:pasteId`

## Code runner

Endpoint `/api/run-code` tetap tersedia, tetapi runner dimatikan secara default:

```env
ENABLE_CODE_RUNNER=false
```

Rewrite ini hanya menyediakan runner JavaScript ketika diaktifkan. Jangan mengaktifkan runner pada server publik tanpa sandbox/container isolation terpisah. Menjalankan kode milik user langsung pada host bukan boundary keamanan yang aman.

## Health check

```bash
curl http://127.0.0.1:8700/health
```

Contoh response:

```json
{
  "status": "healthy",
  "runtime": "node v22.x.x",
  "storage": "json_files",
  "total_users": 1,
  "total_pastes": 0,
  "total_views": 0
}
```

## Struktur project

```text
codeshare-node22/
├── src/
│   ├── config.js
│   ├── executor.js
│   ├── realtime.js
│   ├── security.js
│   ├── server.js
│   └── store.js
├── public/
│   ├── app.css
│   └── app.js
├── templates/
├── data/
├── .env.example
├── Dockerfile
├── ecosystem.config.cjs
└── package.json
```
