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
Deploy free on Render:
1. Push this folder to a GitHub repo.
2. Go to https://render.com → New → Web Service → pick your repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Add a disk for `/opt/render/project/src/uploads` (1 GB free) so
   uploaded videos survive restarts, or set `UPLOAD_DIR` to the disk path.
5. Set env var `JWT_SECRET` to a long random string.
6. Your backend is now at `https://your-app.onrender.com` — the Flux app
   connects to that URL.

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
