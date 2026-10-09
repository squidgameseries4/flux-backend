"use strict";
/* Videos, shorts, posts. */

const express = require("express");
const db = require("../db");
const { required, optional } = require("../auth");
const { publicUser } = require("./auth");
const { upload, fileUrl, deleteFile } = require("../uploads");

const router = express.Router();
const now = () => Date.now();

async function withCounts(row, type, meId) {
  const likes = Number((await db.prepare("SELECT COUNT(*) c FROM likes WHERE target_type=? AND target_id=?").get(type, row.id)).c);
  const comments = Number((await db.prepare("SELECT COUNT(*) c FROM comments WHERE target_type=? AND target_id=?").get(type, row.id)).c);
  const liked = meId ? !!await db.prepare("SELECT 1 FROM likes WHERE user_id=? AND target_type=? AND target_id=?").get(meId, type, row.id) : false;
  const author = publicUser(await db.prepare("SELECT * FROM users WHERE id=?").get(row.user_id));
  return { ...row, author, likes, comments, liked_by_me: liked };
}
function rmFile(url) {
  /* fire-and-forget: deleteFile is best-effort and never throws */
  deleteFile(url).catch(() => {});
}

/* ---------- image upload (avatar / banner) ---------- */

// POST /api/upload/image  (multipart: file) -> { ok, url }
router.post("/upload/image", required, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file" });
  if (!/^image\//.test(req.file.mimetype)) { rmFile("/uploads/" + req.file.filename); return res.status(400).json({ ok: false, error: "Only images allowed" }); }
  res.json({ ok: true, url: await fileUrl(req, req.file) });
});

/* ---------- videos ---------- */

// POST /api/videos  (multipart: file, thumbnail?, title, description, duration, visibility, made_for_kids, location)
router.post("/videos", required, upload.fields([{ name: "file", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]), async (req, res) => {
  const f = (req.files && req.files.file && req.files.file[0]) || null;
  if (!f) return res.status(400).json({ ok: false, error: "Video file is required" });
  const th = (req.files && req.files.thumbnail && req.files.thumbnail[0]) || null;
  const title = String(req.body.title || "Untitled").trim().slice(0, 100);
  const r = await db.prepare(`INSERT INTO videos
    (user_id,title,description,file_url,thumb_url,duration,visibility,made_for_kids,location,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    req.user.id, title,
    String(req.body.description || "").slice(0, 2000),
    await fileUrl(req, f), th ? await fileUrl(req, th) : "",
    parseFloat(req.body.duration) || 0,
    String(req.body.visibility || "Public").slice(0, 20),
    req.body.made_for_kids ? 1 : 0,
    String(req.body.location || "").slice(0, 80),
    now()
  );
  const v = await db.prepare("SELECT * FROM videos WHERE id=?").get(r.lastInsertRowid);
  res.status(201).json({ ok: true, video: await withCounts(v, "video", req.user.id) });
});

// GET /api/videos?limit=50&offset=0
router.get("/videos", optional, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const rows = await db.prepare("SELECT * FROM videos ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  res.json({ ok: true, videos: await Promise.all(rows.map(async v => withCounts(v, "video", req.user && req.user.id))) });
});

// GET /api/videos/:id
router.get("/videos/:id", optional, async (req, res) => {
  const v = await db.prepare("SELECT * FROM videos WHERE id=?").get(req.params.id);
  if (!v) return res.status(404).json({ ok: false, error: "Video not found" });
  res.json({ ok: true, video: await withCounts(v, "video", req.user && req.user.id) });
});

// POST /api/videos/:id/view
router.post("/videos/:id/view", async (req, res) => {
  await db.prepare("UPDATE videos SET views=views+1 WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/videos/:id  (owner only)
router.delete("/videos/:id", required, async (req, res) => {
  const v = await db.prepare("SELECT * FROM videos WHERE id=?").get(req.params.id);
  if (!v) return res.status(404).json({ ok: false, error: "Video not found" });
  if (v.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "Not your video" });
  rmFile(v.file_url); rmFile(v.thumb_url);
  await db.prepare("DELETE FROM videos WHERE id=?").run(v.id);
  await db.prepare("DELETE FROM likes WHERE target_type='video' AND target_id=?").run(v.id);
  await db.prepare("DELETE FROM comments WHERE target_type='video' AND target_id=?").run(v.id);
  res.json({ ok: true });
});

/* ---------- shorts ---------- */

// POST /api/shorts (multipart: file, thumbnail?, caption, description, duration, visibility)
router.post("/shorts", required, upload.fields([{ name: "file", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]), async (req, res) => {
  const f = (req.files && req.files.file && req.files.file[0]) || null;
  if (!f) return res.status(400).json({ ok: false, error: "Video file is required" });
  const th = (req.files && req.files.thumbnail && req.files.thumbnail[0]) || null;
  const caption = String(req.body.caption || "Untitled").trim().slice(0, 100);
  const r = await db.prepare(`INSERT INTO shorts
    (user_id,caption,description,file_url,thumb_url,duration,visibility,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    req.user.id, caption,
    String(req.body.description || "").slice(0, 2000),
    await fileUrl(req, f), th ? await fileUrl(req, th) : "",
    parseFloat(req.body.duration) || 0,
    String(req.body.visibility || "Public").slice(0, 20),
    now()
  );
  const s = await db.prepare("SELECT * FROM shorts WHERE id=?").get(r.lastInsertRowid);
  res.status(201).json({ ok: true, short: await withCounts(s, "short", req.user.id) });
});

// GET /api/shorts
router.get("/shorts", optional, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const rows = await db.prepare("SELECT * FROM shorts ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  res.json({ ok: true, shorts: await Promise.all(rows.map(async s => withCounts(s, "short", req.user && req.user.id))) });
});

// GET /api/shorts/:id
router.get("/shorts/:id", optional, async (req, res) => {
  const s = await db.prepare("SELECT * FROM shorts WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Short not found" });
  res.json({ ok: true, short: await withCounts(s, "short", req.user && req.user.id) });
});

// POST /api/shorts/:id/view
router.post("/shorts/:id/view", async (req, res) => {
  await db.prepare("UPDATE shorts SET views=views+1 WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/shorts/:id (owner only)
router.delete("/shorts/:id", required, async (req, res) => {
  const s = await db.prepare("SELECT * FROM shorts WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Short not found" });
  if (s.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "Not your short" });
  rmFile(s.file_url); rmFile(s.thumb_url);
  await db.prepare("DELETE FROM shorts WHERE id=?").run(s.id);
  await db.prepare("DELETE FROM likes WHERE target_type='short' AND target_id=?").run(s.id);
  await db.prepare("DELETE FROM comments WHERE target_type='short' AND target_id=?").run(s.id);
  res.json({ ok: true });
});

/* ---------- posts ---------- */

// POST /api/posts {text}
router.post("/posts", required, async (req, res) => {
  const text = String(req.body.text || "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ ok: false, error: "Text is required" });
  const r = await db.prepare("INSERT INTO posts (user_id,text,created_at) VALUES (?,?,?)").run(req.user.id, text, now());
  const p = await db.prepare("SELECT * FROM posts WHERE id=?").get(r.lastInsertRowid);
  res.status(201).json({ ok: true, post: await withCounts(p, "post", req.user.id) });
});

// GET /api/posts
router.get("/posts", optional, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const rows = await db.prepare("SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset);
  res.json({ ok: true, posts: await Promise.all(rows.map(async p => withCounts(p, "post", req.user && req.user.id))) });
});

// DELETE /api/posts/:id (owner only)
router.delete("/posts/:id", required, async (req, res) => {
  const p = await db.prepare("SELECT * FROM posts WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: "Post not found" });
  if (p.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "Not your post" });
  await db.prepare("DELETE FROM posts WHERE id=?").run(p.id);
  await db.prepare("DELETE FROM likes WHERE target_type='post' AND target_id=?").run(p.id);
  await db.prepare("DELETE FROM comments WHERE target_type='post' AND target_id=?").run(p.id);
  res.json({ ok: true });
});

module.exports = { router, withCounts };
