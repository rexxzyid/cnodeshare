# CodeShare Node.js 22+

CodeShare adalah platform berbagi kode (paste) yang berjalan sebagai satu proses Node.js dengan Express, Nunjucks, WebSocket, dan penyimpanan file JSON. Versi ini adalah rewrite penuh dari backend FastAPI/Python dan tetap kompatibel dengan struktur data lama.

Antarmuka memakai gaya neobrutalism: border tebal, hard shadow, aksen warna solid, dan dua mode tema (light/dark) yang bisa diganti lewat tombol di navbar.

## Daftar isi

- [Requirement](#requirement)
- [Install](#install)
- [Struktur halaman](#struktur-halaman)
- [Environment](#environment)
- [Cloudflare Tunnel](#cloudflare-tunnel)
- [Cloudflare Zero Trust (Access)](#cloudflare-zero-trust-access)
- [Google OAuth](#google-oauth)
- [PM2](#pm2)
- [Docker](#docker)
- [Admin default](#admin-default)
- [Badge](#badge)
- [Migrasi data dari versi Python](#migrasi-data-dari-versi-python)
- [Endpoint utama](#endpoint-utama)
- [Code runner](#code-runner)
- [Health check](#health-check)
- [Struktur project](#struktur-project)

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

Cek sintaks seluruh modul:

```bash
npm run check
```

## Struktur halaman

Landing page dan pencarian dipisah supaya masing-masing punya satu tugas.

| Halaman | Path | Isi |
| --- | --- | --- |
| Landing | `/` | Hero, statistik platform, fitur, 6 paste publik terbaru, CTA. Tidak ada form filter. |
| Search | `/search` | Halaman pencarian penuh: query, filter bahasa, filter author, sorting, pagination, dan chip filter aktif. |
| Users | `/users` | Daftar akun beserta badge dan filter username sisi klien. |
| Feed | `/feed` | Paste terbaru dari user yang diikuti. |
| Dashboard | `/dashboard` | Paste milik sendiri, profil, notifikasi, dan panel admin. |

Halaman `/search` menyimpan state pencarian di query string, jadi hasil pencarian bisa dibagikan sebagai link:

```text
/search?q=websocket&language=javascript&sort=most_viewed&page=2
```

Semua tombol pencarian di landing page dan navbar mengarah ke halaman ini.

## Environment

Semua variabel ada di `.env.example`.

### Dasar

```env
PORT=8700
HOST=0.0.0.0
NODE_ENV=production
PUBLIC_BASE_URL=http://localhost:8700
SECRET_KEY=change-this-to-a-long-random-secret
ACCESS_TOKEN_EXPIRE_MINUTES=30
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ADMIN_EMAIL=admin@codeshare.local
TRUST_PROXY=1
```

| Variabel | Fungsi |
| --- | --- |
| `PUBLIC_BASE_URL` | URL publik aplikasi (domain Cloudflare kamu). Dipakai sebagai default `GOOGLE_REDIRECT_URI`. |
| `SECRET_KEY` | Kunci penandatangan JWT sesi user. Wajib diganti sebelum production. |
| `TRUST_PROXY` | Jumlah proxy di depan aplikasi. Isi `1` saat berada di belakang cloudflared supaya rate limit membaca IP asli. |

### Cloudflare

```env
CLOUDFLARE_TUNNEL_TOKEN=
CLOUDFLARE_TUNNEL_NAME=codeshare
CLOUDFLARE_TUNNEL_HOSTNAME=

CF_ACCESS_ENABLED=false
CF_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
CF_ACCESS_AUD=
CF_ACCESS_PROTECTED_PATHS=/dashboard,/api/admin
```

| Variabel | Dibaca oleh | Fungsi |
| --- | --- | --- |
| `CLOUDFLARE_TUNNEL_TOKEN` | cloudflared | Token connector dari dashboard Cloudflare (mode remotely-managed tunnel). |
| `CLOUDFLARE_TUNNEL_NAME` | cloudflared | Nama tunnel saat memakai konfigurasi lokal. |
| `CLOUDFLARE_TUNNEL_HOSTNAME` | cloudflared | Hostname publik yang diarahkan ke aplikasi, contoh `kode.domain.com`. |
| `CF_ACCESS_ENABLED` | aplikasi | Mengaktifkan verifikasi JWT Cloudflare Access di sisi origin. |
| `CF_ACCESS_TEAM_DOMAIN` | aplikasi | Team domain Zero Trust, contoh `https://namatim.cloudflareaccess.com`. |
| `CF_ACCESS_AUD` | aplikasi | Application Audience (AUD) tag dari Access application. |
| `CF_ACCESS_PROTECTED_PATHS` | aplikasi | Daftar prefix path yang wajib lolos Access, dipisah koma. |

## Cloudflare Tunnel

Cloudflare Tunnel membuat aplikasi bisa diakses lewat domain HTTPS tanpa membuka port apa pun ke internet. Origin cukup mendengarkan di localhost.

### 1. Ikat aplikasi ke localhost

```env
HOST=127.0.0.1
PORT=8700
PUBLIC_BASE_URL=https://kode.domain.com
TRUST_PROXY=1
```

Dengan `HOST=127.0.0.1`, satu-satunya jalan masuk ke aplikasi adalah lewat cloudflared.

### 2. Install cloudflared

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared
cloudflared --version
```

### 3. Opsi A: tunnel dengan konfigurasi lokal

```bash
cloudflared tunnel login
cloudflared tunnel create codeshare
cloudflared tunnel route dns codeshare kode.domain.com
```

Buat `/etc/cloudflared/config.yml`:

```yaml
tunnel: codeshare
credentials-file: /root/.cloudflared/codeshare.json
ingress:
  - hostname: kode.domain.com
    service: http://127.0.0.1:8700
    originRequest:
      noTLSVerify: false
      connectTimeout: 30s
  - service: http_status:404
```

Jalankan sebagai service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

### 4. Opsi B: tunnel dengan token

Buat tunnel dari dashboard Zero Trust (`Networks` → `Tunnels` → `Create a tunnel`), salin token connector ke `.env` sebagai `CLOUDFLARE_TUNNEL_TOKEN`, lalu jalankan:

```bash
cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN"
```

Public hostname diatur dari dashboard: `kode.domain.com` → `http://127.0.0.1:8700`.

### 5. WebSocket

Fitur realtime memakai WebSocket di path `/ws`. Cloudflare Tunnel meneruskan WebSocket secara otomatis, tetapi pastikan opsi `Network` → `WebSockets` pada dashboard Cloudflare dalam keadaan aktif. Tidak ada konfigurasi tambahan di `config.yml`.

### 6. Docker Compose dengan cloudflared

```yaml
services:
  codeshare:
    build: .
    env_file: .env
    expose:
      - "8700"
    volumes:
      - codeshare-data:/app/data
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - codeshare
    restart: unless-stopped

volumes:
  codeshare-data:
```

Pada mode ini public hostname diarahkan ke `http://codeshare:8700` karena keduanya berada di jaringan compose yang sama, dan port aplikasi tidak pernah dipublikasikan ke host.

## Cloudflare Zero Trust (Access)

Cloudflare Tunnel menyembunyikan origin, tetapi domainnya tetap publik. Zero Trust Access menambahkan lapisan autentikasi di depan path sensitif seperti `/dashboard` dan `/api/admin`.

### 1. Buat Access application

Dashboard Zero Trust → `Access` → `Applications` → `Add an application` → `Self-hosted`.

- Application domain: `kode.domain.com`
- Path: `dashboard` (buat satu application lagi untuk `api/admin` bila perlu)
- Identity provider: sesuai kebutuhan (Google, GitHub, One-time PIN)

Setelah aplikasi dibuat, salin nilai **Application Audience (AUD) Tag** dari tab `Overview`.

### 2. Buat policy

Contoh policy paling sederhana:

| Nama | Action | Rule |
| --- | --- | --- |
| Admin only | Allow | Emails: `kamu@domain.com` |
| Block others | Block | Everyone |

### 3. Aktifkan verifikasi di origin

```env
CF_ACCESS_ENABLED=true
CF_ACCESS_TEAM_DOMAIN=https://namatim.cloudflareaccess.com
CF_ACCESS_AUD=aud-tag-dari-dashboard
CF_ACCESS_PROTECTED_PATHS=/dashboard,/api/admin
```

Yang dilakukan aplikasi saat opsi ini aktif:

1. Setiap request ke path terlindungi diperiksa header `Cf-Access-Jwt-Assertion` atau cookie `CF_Authorization`.
2. Token diverifikasi dengan public key dari `https://namatim.cloudflareaccess.com/cdn-cgi/access/certs` (di-cache satu jam, algoritma RS256, `aud` dan `iss` dicek).
3. Token tidak valid membuat request HTML dijawab halaman error 403 dan request API dijawab JSON `403`.

Verifikasi ini penting karena tanpa pengecekan di origin, siapa pun yang menemukan alamat origin bisa melewati Access. Selama origin hanya bisa dijangkau lewat tunnel, kombinasi keduanya menutup dua jalur sekaligus.

Kalau `CF_ACCESS_ENABLED=true` tetapi `CF_ACCESS_TEAM_DOMAIN` atau `CF_ACCESS_AUD` kosong, aplikasi menulis peringatan di log dan melewati pengecekan agar server tidak mengunci diri sendiri.

### 4. Akses API dengan service token

Untuk otomatisasi (monitoring, cron, CI) buat `Service Auth` token di Zero Trust, tambahkan policy `Service Auth` pada application, lalu panggil API dengan dua header:

```bash
curl https://kode.domain.com/api/admin/stats \
  -H "CF-Access-Client-Id: <client-id>" \
  -H "CF-Access-Client-Secret: <client-secret>" \
  -H "Authorization: Bearer <token-codeshare>"
```

Header Cloudflare untuk melewati Access, header `Authorization` tetap dibutuhkan untuk sesi CodeShare.

### 5. Status konfigurasi

```bash
curl https://kode.domain.com/health
```

Bagian `cloudflare` pada response menunjukkan apakah Access aktif dan path mana yang dilindungi.

## Google OAuth

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://kode.domain.com/auth/google/callback
```

Jika `GOOGLE_REDIRECT_URI` dikosongkan, nilainya otomatis mengikuti `PUBLIC_BASE_URL` + `/auth/google/callback`. Pastikan URL yang sama terdaftar di Google Cloud Console.

Jika client id dan secret belum diisi, tombol Google tetap tampil tetapi server mengarahkan kembali ke halaman login dengan status bahwa OAuth belum dikonfigurasi.

Halaman `/auth/google/callback` juga perlu dikecualikan dari Access application supaya alur login Google tidak diblokir dua kali.

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
  -p 127.0.0.1:8700:8700 \
  --env-file .env \
  -v codeshare-data:/app/data \
  codeshare-node22
```

Publikasi port sengaja diikat ke `127.0.0.1` agar hanya cloudflared di host yang dapat menjangkaunya.

## Admin default

Saat `data/users/<ADMIN_USERNAME>.json` belum ada, server membuat admin otomatis dari environment:

```text
username: admin
password: admin123
```

Credential ini hanya fallback awal dan harus diganti untuk deployment publik.

## Badge

Badge dihitung ulang otomatis dari jumlah paste dan total views, lalu ditampilkan sebagai chip dengan ikon SVG (bukan emoji) yang punya warna berbeda per jenis.

| Badge | Ikon | Syarat |
| --- | --- | --- |
| Newcomer | tunas | Akun baru tanpa aktivitas |
| Member | user | 3 paste dan 100 views |
| Verified | perisai | Diverifikasi admin, atau 8 paste dan 500 views |
| Pro | bintang | 15 paste dan 2.000 views |
| Expert | piala | 25 paste dan 5.000 views |
| Legend | mahkota | 50 paste dan 10.000 views |
| Popular | api | Total views di atas 1.000 |
| Prolific | pena | 10 paste |
| Admin | petir | Akun admin |
| Google | globe | Masuk lewat akun Google |

Ikon disimpan sebagai sprite SVG di `templates/partials/icons.html` dan dirender lewat macro `templates/partials/badge.html` untuk sisi server, atau `badgeHtml()` di `public/app.js` untuk sisi klien.

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

Kalau versi Python lama sudah memiliki folder `data`, copy folder tersebut ke root project ini sebelum start:

```bash
cp -a /path/codeshare-python/data/. ./data/
npm start
```

Password user lama tetap dapat diverifikasi karena bcrypt hash dari versi Python kompatibel dengan `bcryptjs`.

## Endpoint utama

### Pages

- `GET /`
- `GET /search`
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

Parameter `GET /api/search`: `q`, `language`, `author`, `sort` (`newest`, `oldest`, `most_viewed`, `title`), `page`, `limit`.

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

Hanya JavaScript yang dijalankan ketika runner diaktifkan. Jangan mengaktifkan runner pada server publik tanpa sandbox atau container isolation terpisah. Menjalankan kode milik user langsung pada host bukan boundary keamanan yang aman.

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
  "cloudflare": {
    "access_enabled": true,
    "team_domain": "https://namatim.cloudflareaccess.com",
    "protected_paths": ["/dashboard", "/api/admin"]
  },
  "total_users": 1,
  "total_pastes": 0,
  "total_views": 0
}
```

## Struktur project

```text
codeshare-node22/
├── src/
│   ├── cloudflare.js
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
│   ├── partials/
│   │   ├── badge.html
│   │   └── icons.html
│   ├── base.html
│   ├── index.html
│   ├── search.html
│   └── ...
├── data/
├── .env.example
├── Dockerfile
├── ecosystem.config.cjs
└── package.json
```
