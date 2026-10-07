"use strict";
/* Feed, search, notifications, user profiles. */

const express = require("express");
const db = require("../db");
const { required, optional } = require("../auth");
const { publicUser } = require("./auth");
const { withCounts } = require("./content");

const router = express.Router();

// GET /api/feed — newest videos + shorts mixed
router.get("/feed", optional, async (req, res) => {
  const me = req.user && req.user.id;
  const limit = Math.min(parseInt(req.query.limit) || 40, 100);
  const videos = await Promise.all((await db.prepare("SELECT * FROM videos ORDER BY created_at DESC LIMIT ?").all(limit))
    .map(async v => ({ kind: "video", ...await withCounts(v, "video", me) })));
  const shorts = await Promise.all((await db.prepare("SELECT * FROM shorts ORDER BY created_at DESC LIMIT ?").all(limit))
    .map(async s => ({ kind: "short", ...await withCounts(s, "short", me) })));
  const feed = [...videos, ...shorts].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
  res.json({ ok: true, feed });
});

// GET /api/search?q=...
router.get("/search", optional, async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (!q) return res.json({ ok: true, videos: [], shorts: [], users: [] });
  const like = "%" + q + "%";
  const me = req.user && req.user.id;
  const videos = await Promise.all((await db.prepare("SELECT * FROM videos WHERE title LIKE ? OR description LIKE ? ORDER BY views DESC LIMIT 25").all(like, like)).map(async v => await withCounts(v, "video", me)));
  const shorts = await Promise.all((await db.prepare("SELECT * FROM shorts WHERE caption LIKE ? ORDER BY created_at DESC LIMIT 25").all(like)).map(async s => await withCounts(s, "short", me)));
  const users = (await db.prepare("SELECT * FROM users WHERE name LIKE ? OR handle LIKE ? LIMIT 10").all(like, like)).map(publicUser);
  res.json({ ok: true, videos, shorts, users });
});

// GET /api/notifications
router.get("/notifications", required, async (req, res) => {
  const rows = await db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(req.user.id);
  const unread = Number((await db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0").get(req.user.id)).c);
  res.json({ ok: true, unread, notifications: rows });
});

// POST /api/notifications/read
router.post("/notifications/read", required, async (req, res) => {
  await db.prepare("UPDATE notifications SET read=1 WHERE user_id=?").run(req.user.id);
  res.json({ ok: true });
});

// GET /api/users/:id — public channel profile
router.get("/users/:id", optional, async (req, res) => {
  const u = await db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!u) return res.status(404).json({ ok: false, error: "User not found" });
  const me = req.user && req.user.id;
  const subs = Number((await db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE channel_id=?").get(u.id)).c);
  const videos = await Promise.all((await db.prepare("SELECT * FROM videos WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(u.id))
    .map(async v => await withCounts(v, "video", me)));
  const shorts = await Promise.all((await db.prepare("SELECT * FROM shorts WHERE user_id=? ORDER BY created_at DESC LIMIT 50").all(u.id))
    .map(async s => await withCounts(s, "short", me)));
  const subscribed = me ? !!await db.prepare("SELECT 1 FROM subscriptions WHERE subscriber_id=? AND channel_id=?").get(me, u.id) : false;
  res.json({ ok: true, user: { ...publicUser(u), subscribers: subs }, videos, shorts, subscribed_by_me: subscribed });
});

module.exports = { router };
