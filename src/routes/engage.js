"use strict";
/* Likes, comments, subscriptions, playlists. */

const express = require("express");
const db = require("../db");
const { required, optional } = require("../auth");
const { publicUser } = require("./auth");

const router = express.Router();
const now = () => Date.now();
const TYPES = ["video", "short", "post"];

async function notify(userId, type, title, body, refType, refId) {
  if (!userId) return;
  await db.prepare(`INSERT INTO notifications (user_id,type,title,body,ref_type,ref_id,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(userId, type, title, body || "", refType || "", refId || 0, now());
}
async function targetOwner(type, id) {
  const t = { video: "videos", short: "shorts", post: "posts" }[type];
  if (!t) return null;
  const row = await db.prepare(`SELECT user_id FROM ${t} WHERE id=?`).get(id);
  return row ? row.user_id : null;
}

/* ---------- likes ---------- */

// POST /api/likes {target_type, target_id}
router.post("/likes", required, async (req, res) => {
  const { target_type, target_id } = req.body;
  if (!TYPES.includes(target_type) || !target_id)
    return res.status(400).json({ ok: false, error: "target_type must be video|short|post and target_id required" });
  const owner = await targetOwner(target_type, target_id);
  if (owner === null) return res.status(404).json({ ok: false, error: "Target not found" });
  await db.prepare("INSERT OR IGNORE INTO likes (user_id,target_type,target_id,created_at) VALUES (?,?,?,?)")
    .run(req.user.id, target_type, target_id, now());
  if (owner !== req.user.id) {
    const me = await db.prepare("SELECT name FROM users WHERE id=?").get(req.user.id);
    await notify(owner, "like", `${me.name} liked your ${target_type}`, "", target_type, target_id);
  }
  const c = Number((await db.prepare("SELECT COUNT(*) c FROM likes WHERE target_type=? AND target_id=?").get(target_type, target_id)).c);
  res.json({ ok: true, likes: c });
});

// DELETE /api/likes {target_type, target_id}
router.delete("/likes", required, async (req, res) => {
  const { target_type, target_id } = req.body;
  await db.prepare("DELETE FROM likes WHERE user_id=? AND target_type=? AND target_id=?").run(req.user.id, target_type, target_id);
  const c = Number((await db.prepare("SELECT COUNT(*) c FROM likes WHERE target_type=? AND target_id=?").get(target_type, target_id)).c);
  res.json({ ok: true, likes: c });
});

/* ---------- comments ---------- */

// GET /api/comments?target_type=video&target_id=3
router.get("/comments", optional, async (req, res) => {
  const { target_type, target_id } = req.query;
  if (!TYPES.includes(target_type) || !target_id)
    return res.status(400).json({ ok: false, error: "target_type and target_id required" });
  const rows = await db.prepare("SELECT * FROM comments WHERE target_type=? AND target_id=? ORDER BY created_at ASC LIMIT 200")
    .all(target_type, target_id);
  res.json({
    ok: true,
    comments: await Promise.all(rows.map(async c => ({ ...c, author: publicUser(await db.prepare("SELECT * FROM users WHERE id=?").get(c.user_id)) }))),
  });
});

// POST /api/comments {target_type, target_id, text}
router.post("/comments", required, async (req, res) => {
  const { target_type, target_id } = req.body;
  const text = String(req.body.text || "").trim().slice(0, 500);
  if (!TYPES.includes(target_type) || !target_id)
    return res.status(400).json({ ok: false, error: "target_type must be video|short|post and target_id required" });
  if (!text) return res.status(400).json({ ok: false, error: "Text is required" });
  const owner = await targetOwner(target_type, target_id);
  if (owner === null) return res.status(404).json({ ok: false, error: "Target not found" });
  const r = await db.prepare("INSERT INTO comments (user_id,target_type,target_id,text,created_at) VALUES (?,?,?,?,?)")
    .run(req.user.id, target_type, target_id, text, now());
  if (owner !== req.user.id) {
    const me = await db.prepare("SELECT name FROM users WHERE id=?").get(req.user.id);
    await notify(owner, "comment", `${me.name} commented on your ${target_type}`, text.slice(0, 120), target_type, target_id);
  }
  const c = await db.prepare("SELECT * FROM comments WHERE id=?").get(r.lastInsertRowid);
  res.status(201).json({ ok: true, comment: { ...c, author: publicUser(await db.prepare("SELECT * FROM users WHERE id=?").get(c.user_id)) } });
});

// DELETE /api/comments/:id (author only)
router.delete("/comments/:id", required, async (req, res) => {
  const c = await db.prepare("SELECT * FROM comments WHERE id=?").get(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: "Comment not found" });
  if (c.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "Not your comment" });
  await db.prepare("DELETE FROM comments WHERE id=?").run(c.id);
  res.json({ ok: true });
});

/* ---------- subscriptions ---------- */

// POST /api/subscriptions/:userId
router.post("/subscriptions/:userId", required, async (req, res) => {
  const channelId = parseInt(req.params.userId);
  if (channelId === req.user.id) return res.status(400).json({ ok: false, error: "You can't subscribe to yourself" });
  const ch = await db.prepare("SELECT * FROM users WHERE id=?").get(channelId);
  if (!ch) return res.status(404).json({ ok: false, error: "Channel not found" });
  await db.prepare("INSERT OR IGNORE INTO subscriptions (subscriber_id,channel_id,created_at) VALUES (?,?,?)")
    .run(req.user.id, channelId, now());
  const me = await db.prepare("SELECT name FROM users WHERE id=?").get(req.user.id);
  await notify(channelId, "subscribe", `${me.name} subscribed to you`, "", "user", req.user.id);
  res.json({ ok: true, subscribed: true });
});

// DELETE /api/subscriptions/:userId
router.delete("/subscriptions/:userId", required, async (req, res) => {
  await db.prepare("DELETE FROM subscriptions WHERE subscriber_id=? AND channel_id=?").run(req.user.id, req.params.userId);
  res.json({ ok: true, subscribed: false });
});

// GET /api/subscriptions/me
router.get("/subscriptions/me", required, async (req, res) => {
  const rows = await db.prepare(`SELECT u.* FROM subscriptions s JOIN users u ON u.id=s.channel_id
    WHERE s.subscriber_id=? ORDER BY s.created_at DESC`).all(req.user.id);
  res.json({ ok: true, channels: rows.map(publicUser) });
});

/* ---------- playlists ---------- */

// GET /api/playlists (mine)
router.get("/playlists", required, async (req, res) => {
  const pls = await db.prepare("SELECT * FROM playlists WHERE user_id=? ORDER BY created_at DESC").all(req.user.id);
  const playlists = await Promise.all(pls.map(async p => ({
    ...p,
    items: await db.prepare("SELECT * FROM playlist_items WHERE playlist_id=? ORDER BY created_at ASC").all(p.id),
  })));
  res.json({ ok: true, playlists });
});

// POST /api/playlists {name}
router.post("/playlists", required, async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ ok: false, error: "Name is required" });
  const r = await db.prepare("INSERT INTO playlists (user_id,name,created_at) VALUES (?,?,?)").run(req.user.id, name, now());
  res.status(201).json({ ok: true, playlist: await db.prepare("SELECT * FROM playlists WHERE id=?").get(r.lastInsertRowid) });
});

// POST /api/playlists/:id/items {target_type: 'video'|'short', target_id}
router.post("/playlists/:id/items", required, async (req, res) => {
  const pl = await db.prepare("SELECT * FROM playlists WHERE id=?").get(req.params.id);
  if (!pl || pl.user_id !== req.user.id) return res.status(404).json({ ok: false, error: "Playlist not found" });
  const { target_type, target_id } = req.body;
  if (!["video", "short"].includes(target_type) || !target_id)
    return res.status(400).json({ ok: false, error: "target_type must be video|short and target_id required" });
  const r = await db.prepare("INSERT INTO playlist_items (playlist_id,target_type,target_id,created_at) VALUES (?,?,?,?)")
    .run(pl.id, target_type, target_id, now());
  res.status(201).json({ ok: true, item: await db.prepare("SELECT * FROM playlist_items WHERE id=?").get(r.lastInsertRowid) });
});

// DELETE /api/playlists/:id/items/:itemId
router.delete("/playlists/:id/items/:itemId", required, async (req, res) => {
  const pl = await db.prepare("SELECT * FROM playlists WHERE id=?").get(req.params.id);
  if (!pl || pl.user_id !== req.user.id) return res.status(404).json({ ok: false, error: "Playlist not found" });
  await db.prepare("DELETE FROM playlist_items WHERE id=? AND playlist_id=?").run(req.params.itemId, pl.id);
  res.json({ ok: true });
});

// DELETE /api/playlists/:id
router.delete("/playlists/:id", required, async (req, res) => {
  const pl = await db.prepare("SELECT * FROM playlists WHERE id=?").get(req.params.id);
  if (!pl || pl.user_id !== req.user.id) return res.status(404).json({ ok: false, error: "Playlist not found" });
  await db.prepare("DELETE FROM playlists WHERE id=?").run(pl.id);
  res.json({ ok: true });
});

module.exports = { router };
