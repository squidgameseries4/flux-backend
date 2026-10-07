"use strict";
/* Admin dashboard API — /api/admin/*. Guarded by ADMIN_KEY.
   Login issues a random token (kept in memory, dies on restart). */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const db = require("../db");
const { publicUser } = require("./auth");
const { UPLOAD_DIR } = require("../uploads");

const router = express.Router();
const ADMIN_KEY = process.env.ADMIN_KEY || "flux-admin-123";
const tokens = new Set();

function adminAuth(req, res, next) {
  const t = req.headers["x-admin-token"];
  if (t && tokens.has(t)) return next();
  return res.status(401).json({ ok: false, error: "Admin login required" });
}

// POST /api/admin/login {key}
router.post("/admin/login", (req, res) => {
  if (String(req.body.key || "") === ADMIN_KEY) {
    const t = crypto.randomBytes(24).toString("hex");
    tokens.add(t);
    return res.json({ ok: true, token: t });
  }
  res.status(401).json({ ok: false, error: "Wrong admin key" });
});

// GET /api/admin/stats
router.get("/admin/stats", adminAuth, async (req, res) => {
  const count = async tbl => Number((await db.prepare(`SELECT COUNT(*) c FROM ${tbl}`).get()).c);
  const since = Date.now() - 14 * 864e5;
  const stampRows = await db.prepare("SELECT created_at FROM users WHERE created_at > ?").all(since);
  const byDay = {};
  for (const r of stampRows) {
    const d = new Date(Number(r.created_at)).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push({ day: d.slice(5), n: byDay[d] || 0 });
  }
  let storage = 0;
  try {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      try { storage += fs.statSync(UPLOAD_DIR + "/" + f).size; } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  res.json({
    ok: true,
    stats: {
      users: await count("users"),
      videos: await count("videos"),
      shorts: await count("shorts"),
      posts: await count("posts"),
      comments: await count("comments"),
      likes: await count("likes"),
      subscriptions: await count("subscriptions"),
      messages: await count("messages"),
      servers: await count("servers"),
      storage_bytes: storage,
      engine: db.isPg ? "postgres" : "sqlite",
    },
    signups_by_day: days,
  });
});

async function page(table, req, extraWhere, cols) {
  const limit = Math.min(parseInt(req.query.limit) || 25, 100);
  const offset = parseInt(req.query.offset) || 0;
  const q = String(req.query.q || "").trim();
  let where = "";
  const params = [];
  if (q && extraWhere) { where = `WHERE (${extraWhere})`; params.push(...Array(extraWhere.split("?").length - 1).fill("%" + q + "%")); }
  const total = Number((await db.prepare(`SELECT COUNT(*) c FROM ${table} ${where}`).get(...params)).c);
  const rows = await db.prepare(`SELECT ${cols} FROM ${table} ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows, limit, offset };
}

// GET /api/admin/users?q=&limit=&offset=
router.get("/admin/users", adminAuth, async (req, res) => {
  const { total, rows, limit, offset } = await page("users", req, "name LIKE ? OR handle LIKE ?", "*");
  const users = await Promise.all(rows.map(async u => ({
    ...publicUser(u),
    videos: Number((await db.prepare("SELECT COUNT(*) c FROM videos WHERE user_id=?").get(u.id)).c),
    shorts: Number((await db.prepare("SELECT COUNT(*) c FROM shorts WHERE user_id=?").get(u.id)).c),
  })));
  res.json({ ok: true, total, limit, offset, users });
});

// DELETE /api/admin/users/:id
router.delete("/admin/users/:id", adminAuth, async (req, res) => {
  await db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

async function withAuthor(row) {
  const u = await db.prepare("SELECT * FROM users WHERE id=?").get(row.user_id);
  return { ...row, author: u ? publicUser(u) : null };
}

// GET /api/admin/videos?q=&limit=&offset=
router.get("/admin/videos", adminAuth, async (req, res) => {
  const { total, rows, limit, offset } = await page("videos", req, "title LIKE ?", "*");
  res.json({ ok: true, total, limit, offset, videos: await Promise.all(rows.map(withAuthor)) });
});
router.delete("/admin/videos/:id", adminAuth, async (req, res) => {
  const v = await db.prepare("SELECT * FROM videos WHERE id=?").get(req.params.id);
  if (v) {
    for (const url of [v.file_url, v.thumb_url]) {
      if (url && url.startsWith("/uploads/")) {
        try { fs.unlinkSync(UPLOAD_DIR + "/" + url.split("/").pop()); } catch (e) { /* ignore */ }
      }
    }
  }
  await db.prepare("DELETE FROM videos WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/shorts
router.get("/admin/shorts", adminAuth, async (req, res) => {
  const { total, rows, limit, offset } = await page("shorts", req, "caption LIKE ?", "*");
  res.json({ ok: true, total, limit, offset, shorts: await Promise.all(rows.map(withAuthor)) });
});
router.delete("/admin/shorts/:id", adminAuth, async (req, res) => {
  await db.prepare("DELETE FROM shorts WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/posts
router.get("/admin/posts", adminAuth, async (req, res) => {
  const { total, rows, limit, offset } = await page("posts", req, "text LIKE ?", "*");
  res.json({ ok: true, total, limit, offset, posts: await Promise.all(rows.map(withAuthor)) });
});
router.delete("/admin/posts/:id", adminAuth, async (req, res) => {
  await db.prepare("DELETE FROM posts WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/comments
router.get("/admin/comments", adminAuth, async (req, res) => {
  const { total, rows, limit, offset } = await page("comments", req, "text LIKE ?", "*");
  res.json({ ok: true, total, limit, offset, comments: await Promise.all(rows.map(withAuthor)) });
});
router.delete("/admin/comments/:id", adminAuth, async (req, res) => {
  await db.prepare("DELETE FROM comments WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/messages
router.get("/admin/messages", adminAuth, async (req, res) => {
  const { total, rows, limit, offset } = await page("messages", req, "text LIKE ?", "*");
  res.json({ ok: true, total, limit, offset, messages: await Promise.all(rows.map(withAuthor)) });
});
router.delete("/admin/messages/:id", adminAuth, async (req, res) => {
  await db.prepare("DELETE FROM messages WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = { router };
