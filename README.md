# Flux Backend

The server for the Flux social app. It stores users, videos, shorts, posts,
comments, likes, subscriptions, playlists, Spaces chat and notifications —
so every user sees the same world, on any device.

Built with Node.js + Express + SQLite (built into Node, no database to install).

## What you need

- **Node.js 22 or newer** — download from https://nodejs.org (LTS)
- That's it. No database server, no extra setup.

## Run it (2 minutes)

```bash
cd flux-backend
npm install
npm start
```

You will see:

```
Flux backend listening on http://localhost:3000
```

Check it works — open this in a browser:

```
http://localhost:3000/api/health
```

You should see `{"ok":true,"app":"flux-backend",...}`.

## How you access it

This is a **server** — it must be running for the app to reach it.

**On your own PC (testing):**
1. Run `npm start` on your PC.
2. Your phone and PC must be on the **same Wi-Fi**.
3. Find your PC's IP (Windows: run `ipconfig`, look for IPv4 Address,
   e.g. `192.168.1.5`).
4. The app will connect to `http://192.168.1.5:3000`.

**On the internet (for everyone, 24/7):**
Deploy free on Render + Neon (no credit card needed for either):
1. Push this folder to a GitHub repo.
2. Database: go to https://neon.tech → sign up free → create a project →
   copy the **connection string** (looks like `postgresql://...@....neon.tech/...?sslmode=require`).
   This keeps all accounts and data safe permanently (Neon free: 1 GB storage,
   100 compute-hours/month, data persists).
3. Go to https://render.com → New → Web Service → pick your repo.
4. Build command: `npm install` — Start command: `npm start`.
5. Set env vars:
   - `DATABASE_URL` = your Neon connection string (tables are created
     automatically on first boot)
   - `JWT_SECRET` = any long random string
   - `ADMIN_KEY` = your admin dashboard key
6. Deploy → your backend is now at `https://your-app.onrender.com` — the
   Flux app connects to that URL.

> Honest free-tier notes (verified Oct 2026): Render's free web service
> sleeps after 15 min of inactivity, so the first request after idle takes
> ~1 minute to wake. Its local disk is wiped on every sleep/redeploy, and
> free services **cannot** attach a persistent disk — so while the database
> above is safe on Neon, uploaded **video files** will disappear when the
> service sleeps or redeploys. For videos to survive for real users, the
> next step is either a paid Render plan ($7/mo Starter) with a disk, or
> moving uploads to object storage (code change — ask Muse).

> Note: video files are stored on the server's disk (`./uploads`).
> The database is a single file (`./flux.db`). Back both up if it matters.

## Admin dashboard (see everything)

Open **http://YOUR-SERVER:3000/admin** in a browser — a website where you
watch and manage the whole backend:

- **Overview** — user/video/short/post/comment/like/message totals, storage
  used, and a 14-day new-users chart
- **Users / Videos / Shorts / Posts / Comments / Messages** — searchable
  tables with pagination; delete anything (deleting a user removes all
  their content)

Login with your admin key (`ADMIN_KEY` env var, default `flux-admin-123`
— **change it in production**).

## Database: thousands of users

Two engines, one code — picked automatically:

| | SQLite (default) | Postgres |
|---|---|---|
| Setup | none, file `flux.db` | set `DATABASE_URL` |
| Good for | thousands of users, single server | heavy traffic, multiple servers |

Both pass the same 65-test suite. To load-test with 3000 fake users:

```bash
node scripts/seed.js --users 3000
```

## Settings (env vars)

| Var | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `JWT_SECRET` | `flux-dev-secret-change-me` | **Change this in production!** Signs login tokens |
| `ADMIN_KEY` | `flux-admin-123` | **Change this in production!** Admin dashboard login |
| `DATABASE_URL` | — | Set to use Postgres instead of SQLite |
| `DB_PATH` | `./flux.db` | Where the SQLite file lives |
| `UPLOAD_DIR` | `./uploads` | Where uploaded videos/images are stored |
| `MAX_UPLOAD_MB` | `400` | Max upload size in MB |

### Durable media storage (optional, recommended on Render)

Render's free disk is **ephemeral**: every redeploy wipes `./uploads`, so
videos, thumbnails, avatars and banners disappear (the database is safe now
that it lives in Postgres, but files don't). Point uploads at a free
S3-compatible bucket instead — both options below have a free 10 GB tier:

- **Cloudflare R2** (recommended): 10 GB storage + 1M writes + 10M reads per
  month free, **zero egress fees** — best for a video app, since watching =
  downloads. [Pricing](https://developers.cloudflare.com/r2/pricing/)
- **Backblaze B2**: 10 GB storage free, unlimited free uploads, 1 GB of free
  downloads **per day** — fine while the app is small, but video views can
  blow past the daily download limit.

Setup (takes ~10 minutes, no code changes needed):

1. Create a bucket (R2: Cloudflare dashboard → R2 → Create bucket;
   B2: Buckets → Create, keep it private).
2. Create API credentials: R2 → Manage R2 API Tokens (Object Read & Write on
   your bucket). B2 → Application Keys → Add (Read and Write, limited to the
   bucket). Note the endpoint shown (R2: `https://<account>.r2.cloudflarestorage.com`,
   B2: `https://s3.<region>.backblazeb2.com`).
3. Make files publicly readable:
   - **R2**: bucket Settings → Public access → allow (gives you a
     `https://pub-<hash>.r2.dev` URL, or connect a custom domain). Leave
     `S3_ACL` unset — R2 rejects ACL headers.
   - **B2**: keep the bucket private, but add one more env var
     `S3_ACL=public-read` so uploaded files are readable through the
     friendly URL `https://f<id>.backblazeb2.com/file/<bucket>`.
4. On Render → your flux-backend service → **Environment**, add:
   `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
   `S3_PUBLIC_URL` (the public URL from step 3) — plus `S3_ACL=public-read`
   if you chose B2 → Save → redeploy.
5. Upload a video in the app and confirm it survives a Manual Deploy.

Without these vars the server keeps the old behavior (local `./uploads`,
served at `/uploads/<file>`) — nothing else changes.

## API overview

Base URL: `http://YOUR-SERVER:3000/api`
Login endpoints return a `token` — send it as
`Authorization: Bearer <token>` on protected routes.

| Method & path | Auth | What it does |
|---|---|---|
| `POST /auth/signup` | – | `{name, handle, password}` → token + user |
| `POST /auth/login` | – | `{handle, password}` → token + user |
| `GET /auth/me` | yes | Your profile |
| `PATCH /auth/me` | yes | Edit name / bio / avatar |
| `GET /feed` | – | Newest videos + shorts mixed |
| `GET /search?q=` | – | Search videos, shorts, users |
| `POST /videos` | yes | Upload video (multipart `file`, `thumbnail?`, fields) |
| `GET /videos`, `GET /videos/:id` | – | List / one video |
| `POST /videos/:id/view` | – | Count a view |
| `DELETE /videos/:id` | yes | Delete own video (+ its file) |
| `POST /shorts`, `GET /shorts`, `GET /shorts/:id`, `DELETE /shorts/:id` | yes/– | Same as videos, `caption` instead of `title` |
| `POST /likes`, `DELETE /likes` | yes | `{target_type: video\|short\|post, target_id}` |
| `GET /comments?target_type=&target_id=` | – | List comments |
| `POST /comments` | yes | `{target_type, target_id, text}` |
| `DELETE /comments/:id` | yes | Own comment only |
| `POST /subscriptions/:userId` | yes | Subscribe (notifies them) |
| `DELETE /subscriptions/:userId` | yes | Unsubscribe |
| `GET /subscriptions/me` | yes | Who I follow |
| `GET /playlists`, `POST /playlists` | yes | My playlists |
| `POST /playlists/:id/items` | yes | `{target_type: video\|short, target_id}` |
| `DELETE /playlists/:id/items/:itemId` | yes | Remove item |
| `POST /posts`, `GET /posts`, `DELETE /posts/:id` | yes/– | Community posts |
| `GET /servers`, `POST /servers` | yes | Spaces servers |
| `GET /servers/:id/channels`, `POST /servers/:id/channels` | yes | Channels |
| `GET /channels/:id/messages` | yes | Chat history |
| `POST /channels/:id/messages` | yes | Send (multipart optional `file`, `text`) |
| `DELETE /messages/:id` | yes | Own message only |
| `GET /notifications` | yes | Mine, with `unread` count |
| `POST /notifications/read` | yes | Mark all read |
| `GET /users/:id` | – | Public channel page data |

All responses look like `{ "ok": true, ... }` or
`{ "ok": false, "error": "reason" }`.

Uploaded files are served at `/uploads/<filename>`.

## Tests

```bash
npm test            # SQLite (default)
PG_MEM=1 npm test   # Postgres adapter (in-memory)
```

Boots the real server on a temp port with a throwaway database and runs
65 checks across every endpoint, including the admin dashboard API.

## What's next

This backend is ready. The second half of the job is **connecting the
Flux app to it** — replacing the phone-only storage with calls to this
API (login screen → `POST /auth/login`, upload → `POST /videos`, etc.).
Ask and it gets wired up.
