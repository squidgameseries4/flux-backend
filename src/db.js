"use strict";
/* Database adapter — one interface, two engines:
 *
 *   SQLite  (default) : zero-config file DB, built into Node 22+ (node:sqlite).
 *                        Handles thousands of users on a single server.
 *   Postgres (optional): set DATABASE_URL env var for hosted / multi-instance
 *                        deployments and heavy concurrent write load.
 *
 * Interface (works identically for both — await works on sync results too):
 *   db.prepare(sql) -> { get(...params), all(...params), run(...params) }
 *   db.exec(sql)    -> run schema / statements
 *   db.close()      -> shut down pool (pg only)
 *
 * run() resolves { lastInsertRowid, changes }.
 */

const path = require("path");

function schema(pk) {
  return `
CREATE TABLE IF NOT EXISTS users (
  id ${pk},
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
  id ${pk},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  file_url TEXT NOT NULL,
  thumb_url TEXT DEFAULT '',
  duration REAL DEFAULT 0,
  views INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'Public',
  made_for_kids INTEGER DEFAULT 0,
  location TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS shorts (
  id ${pk},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption TEXT NOT NULL,
  description TEXT DEFAULT '',
  file_url TEXT NOT NULL,
  thumb_url TEXT DEFAULT '',
  duration REAL DEFAULT 0,
  views INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'Public',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id ${pk},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id ${pk},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS likes (
  id ${pk},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id ${pk},
  subscriber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  UNIQUE(subscriber_id, channel_id)
);
CREATE TABLE IF NOT EXISTS playlists (
  id ${pk},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS playlist_items (
  id ${pk},
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id ${pk},
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  ref_type TEXT DEFAULT '',
  ref_id INTEGER DEFAULT 0,
  read INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS servers (
  id ${pk},
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id ${pk},
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'text',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id ${pk},
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT DEFAULT '',
  file_url TEXT DEFAULT '',
  file_type TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_shorts_user ON shorts(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_channel ON subscriptions(channel_id);
`;
}

function splitStatements(sql) {
  return sql.split(/;\s*\n/).map(s => s.trim()).filter(s => s && s !== ";").map(s => (s.endsWith(";") ? s : s + ";"));
}

let db;

if (process.env.PG_MEM === "1") {
  /* In-memory Postgres (pg-mem) — used by the test suite. */
  const { newDb } = require("pg-mem");
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  db = makePg(pool, true);
  db.ready = (async () => {
    for (const st of splitStatements(schema("SERIAL PRIMARY KEY"))) await pool.query(st);
  })();
} else if (process.env.DATABASE_URL) {
  /* Real Postgres. */
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
  pool.on("error", e => console.error("pg pool error", e));
  db = makePg(pool, false);
  db.ready = (async () => {
    for (const st of splitStatements(schema("SERIAL PRIMARY KEY"))) await pool.query(st);
    console.log("Postgres schema ready");
  })().catch(e => { console.error("pg schema failed", e); process.exit(1); });
} else {
  /* SQLite (default). */
  const { DatabaseSync } = require("node:sqlite");
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "flux.db");
  const sq = new DatabaseSync(DB_PATH);
  sq.exec("PRAGMA journal_mode = WAL;");
  sq.exec(schema("INTEGER PRIMARY KEY AUTOINCREMENT"));
  db = {
    isPg: false,
    prepare(sql) {
      const st = sq.prepare(sql);
      return {
        get: (...p) => st.get(...p) || null,
        all: (...p) => st.all(...p),
        run: (...p) => { const r = st.run(...p); return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes }; },
      };
    },
    exec: sql => sq.exec(sql),
    close: () => sq.close(),
    ready: Promise.resolve(),
  };
}

function makePg(pool, isMem) {
  return {
    isPg: true,
    _pool: pool,
    prepare(sql) {
      let i = 0;
      let text = sql.replace(/\?/g, () => "$" + ++i);
      const hadOrIgnore = /INSERT OR IGNORE INTO/i.test(sql);
      text = text.replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO");
      const isInsert = /^\s*insert\s/i.test(sql);
      if (isInsert && !/returning\s/i.test(sql)) {
        text += (hadOrIgnore ? " ON CONFLICT DO NOTHING" : "") + " RETURNING id";
      }
      return {
        get: async (...p) => (await pool.query(text, p)).rows[0] || null,
        all: async (...p) => (await pool.query(text, p)).rows,
        run: async (...p) => {
          const r = await pool.query(text, p);
          return { lastInsertRowid: r.rows[0] ? Number(r.rows[0].id) : 0, changes: r.rowCount };
        },
      };
    },
    exec: async sql => { for (const st of splitStatements(sql)) await pool.query(st); },
    close: async () => { try { await pool.end(); } catch (e) { /* ignore */ } },
  };
}

module.exports = db;
