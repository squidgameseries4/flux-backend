"use strict";
/* Spaces: servers, channels, messages (with optional file attachments). */

const express = require("express");
const db = require("../db");
const { required } = require("../auth");
const { publicUser } = require("./auth");
const { upload, fileUrl } = require("../uploads");

const router = express.Router();
const now = () => Date.now();

async function withUser(msg) {
  const u = await db.prepare("SELECT * FROM users WHERE id=?").get(msg.user_id);
  return { ...msg, author: publicUser(u) };
}

/* ---------- servers ---------- */

// GET /api/servers
router.get("/servers", required, async (req, res) => {
  const rows = await db.prepare("SELECT * FROM servers ORDER BY created_at ASC").all();
  res.json({ ok: true, servers: rows });
});

// POST /api/servers {name, description, is_public}
router.post("/servers", required, async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ ok: false, error: "Name is required" });
  const desc = String(req.body.description || "").trim().slice(0, 280);
  const pub = req.body.is_public === false || req.body.is_public === 0 ? 0 : 1;
  const r = await db.prepare("INSERT INTO servers (owner_id,name,description,is_public,created_at) VALUES (?,?,?,?,?)").run(req.user.id, name, desc, pub, now());
  const server = await db.prepare("SELECT * FROM servers WHERE id=?").get(r.lastInsertRowid);
  // default channels, like a fresh Discord server
  for (const [n, k] of [["welcome", "text"], ["general-chat", "text"], ["clips", "text"]])
    await db.prepare("INSERT INTO channels (server_id,name,kind,created_at) VALUES (?,?,?,?)").run(server.id, n, k, now());
  res.status(201).json({ ok: true, server });
});

// DELETE /api/servers/:id (owner only)
router.delete("/servers/:id", required, async (req, res) => {
  const s = await db.prepare("SELECT * FROM servers WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Server not found" });
  if (s.owner_id !== req.user.id) return res.status(403).json({ ok: false, error: "Only the owner can delete this server" });
  await db.prepare("DELETE FROM servers WHERE id=?").run(s.id);
  res.json({ ok: true });
});

// GET /api/servers/discover?q= — public community directory (no login needed)
router.get("/servers/discover", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  let rows;
  if (q) {
    const like = "%" + q.replace(/[%_]/g, "") + "%";
    rows = await db.prepare(
      "SELECT s.*, u.handle AS owner_handle FROM servers s LEFT JOIN users u ON u.id=s.owner_id WHERE s.is_public=1 AND (s.name LIKE ? OR s.description LIKE ?) ORDER BY s.created_at DESC LIMIT 50"
    ).all(like, like);
  } else {
    rows = await db.prepare(
      "SELECT s.*, u.handle AS owner_handle FROM servers s LEFT JOIN users u ON u.id=s.owner_id WHERE s.is_public=1 ORDER BY s.created_at DESC LIMIT 50"
    ).all();
  }
  // member counts
  for (const s of rows) {
    const mc = await db.prepare("SELECT COUNT(*) AS n FROM server_members WHERE server_id=?").get(s.id);
    s.member_count = (mc ? mc.n : 0) + 1; // +1 for owner
  }
  res.json({ ok: true, servers: rows });
});

// POST /api/servers/:id/join — join a public server
router.post("/servers/:id/join", required, async (req, res) => {
  const s = await db.prepare("SELECT * FROM servers WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Server not found" });
  if (!s.is_public && s.owner_id !== req.user.id) return res.status(403).json({ ok: false, error: "This community is private" });
  await db.prepare("INSERT OR IGNORE INTO server_members (server_id,user_id,joined_at) VALUES (?,?,?)").run(s.id, req.user.id, now());
  const ch = await db.prepare("SELECT * FROM channels WHERE server_id=? ORDER BY created_at ASC").all(s.id);
  const owner = publicUser(await db.prepare("SELECT * FROM users WHERE id=?").get(s.owner_id));
  res.json({ ok: true, server: s, channels: ch, owner });
});

// POST /api/servers/:id/leave
router.post("/servers/:id/leave", required, async (req, res) => {
  await db.prepare("DELETE FROM server_members WHERE server_id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ---------- channels ---------- */

// GET /api/servers/:id/channels
router.get("/servers/:id/channels", required, async (req, res) => {
  const s = await db.prepare("SELECT * FROM servers WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Server not found" });
  res.json({ ok: true, channels: await db.prepare("SELECT * FROM channels WHERE server_id=? ORDER BY created_at ASC").all(s.id) });
});

// POST /api/servers/:id/channels {name, kind}
router.post("/servers/:id/channels", required, async (req, res) => {
  const s = await db.prepare("SELECT * FROM servers WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Server not found" });
  const name = String(req.body.name || "").trim().slice(0, 40).replace(/\s+/g, "-").toLowerCase();
  if (!name) return res.status(400).json({ ok: false, error: "Name is required" });
  const kind = req.body.kind === "voice" ? "voice" : "text";
  const r = await db.prepare("INSERT INTO channels (server_id,name,kind,created_at) VALUES (?,?,?,?)").run(s.id, name, kind, now());
  res.status(201).json({ ok: true, channel: await db.prepare("SELECT * FROM channels WHERE id=?").get(r.lastInsertRowid) });
});

/* ---------- messages ---------- */

// GET /api/channels/:id/messages?limit=100&before=<id>
router.get("/channels/:id/messages", required, async (req, res) => {
  const ch = await db.prepare("SELECT * FROM channels WHERE id=?").get(req.params.id);
  if (!ch) return res.status(404).json({ ok: false, error: "Channel not found" });
  const limit = Math.min(parseInt(req.query.limit) || 100, 200);
  const before = parseInt(req.query.before) || 0;
  const rows = before
    ? await db.prepare("SELECT * FROM messages WHERE channel_id=? AND id<? ORDER BY id DESC LIMIT ?").all(ch.id, before, limit)
    : await db.prepare("SELECT * FROM messages WHERE channel_id=? ORDER BY id DESC LIMIT ?").all(ch.id, limit);
  res.json({ ok: true, messages: await Promise.all(rows.reverse().map(withUser)) });
});

// POST /api/channels/:id/messages (multipart optional: file, text)
router.post("/channels/:id/messages", required, upload.single("file"), async (req, res) => {
  const ch = await db.prepare("SELECT * FROM channels WHERE id=?").get(req.params.id);
  if (!ch) return res.status(404).json({ ok: false, error: "Channel not found" });
  const text = String(req.body.text || "").trim().slice(0, 2000);
  let file_url = "", file_type = "";
  if (req.file) {
    file_url = await fileUrl(req, req.file);
    file_type = req.file.mimetype.startsWith("video/") ? "video" : "image";
  }
  if (!text && !file_url) return res.status(400).json({ ok: false, error: "Message text or file required" });
  const r = await db.prepare("INSERT INTO messages (channel_id,user_id,text,file_url,file_type,created_at) VALUES (?,?,?,?,?,?)")
    .run(ch.id, req.user.id, text, file_url, file_type, now());
  res.status(201).json({ ok: true, message: await withUser(await db.prepare("SELECT * FROM messages WHERE id=?").get(r.lastInsertRowid)) });
});

// DELETE /api/messages/:id (author only)
router.delete("/messages/:id", required, async (req, res) => {
  const m = await db.prepare("SELECT * FROM messages WHERE id=?").get(req.params.id);
  if (!m) return res.status(404).json({ ok: false, error: "Message not found" });
  if (m.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "Not your message" });
  await db.prepare("DELETE FROM messages WHERE id=?").run(m.id);
  res.json({ ok: true });
});

module.exports = { router };
