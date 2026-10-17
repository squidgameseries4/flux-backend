"use strict";
/* Direct messages between users. */

const express = require("express");
const db = require("../db");
const { required } = require("../auth");

const router = express.Router();
const now = () => Date.now();

// POST /api/dm/send {to_id, body} — send a DM
router.post("/dm/send", required, async (req, res) => {
  try {
    const toId = parseInt(req.body.to_id);
    const body = String(req.body.body || "").trim().slice(0, 2000);
    if (!toId || !body) return res.status(400).json({ ok: false, error: "Missing recipient or message" });
    if (toId === req.user.id) return res.status(400).json({ ok: false, error: "Cannot message yourself" });
    const toUser = await db.prepare("SELECT id FROM users WHERE id=?").get(toId);
    if (!toUser) return res.status(404).json({ ok: false, error: "User not found" });
    const r = await db.prepare("INSERT INTO direct_messages (sender_id,receiver_id,body,created_at) VALUES (?,?,?,?)").run(req.user.id, toId, body, now());
    res.json({ ok: true, msg: { id: r.lastID, sender_id: req.user.id, receiver_id: toId, body, created_at: Date.now() } });
  } catch (e) {
    console.error("dm send error:", e.message);
    res.status(500).json({ ok: false, error: "Send failed" });
  }
});

// GET /api/dm/thread/:userId — get conversation with a user
router.get("/dm/thread/:userId", required, async (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    if (!otherId) return res.status(400).json({ ok: false, error: "Invalid user" });
    const since = parseInt(req.query.since) || 0;
    const msgs = await db.prepare(
      "SELECT id,sender_id,receiver_id,body,created_at FROM direct_messages WHERE ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) AND created_at>? ORDER BY created_at ASC LIMIT 200"
    ).all(req.user.id, otherId, otherId, req.user.id, since);
    res.json({ ok: true, messages: msgs });
  } catch (e) {
    console.error("dm thread error:", e.message);
    res.status(500).json({ ok: false, error: "Load failed" });
  }
});

// GET /api/dm/inbox — list recent DM conversations
router.get("/dm/inbox", required, async (req, res) => {
  try {
    const rows = await db.prepare(`
      SELECT DISTINCT
        CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END as other_id,
        MAX(created_at) as last_at
      FROM direct_messages
      WHERE sender_id=? OR receiver_id=?
      GROUP BY other_id ORDER BY last_at DESC LIMIT 50
    `).all(req.user.id, req.user.id, req.user.id);
    const out = [];
    for (const r of rows) {
      const u = await db.prepare("SELECT id,name,handle FROM users WHERE id=?").get(r.other_id);
      if (u) out.push({ user: u, last_at: r.last_at });
    }
    res.json({ ok: true, conversations: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Load failed" });
  }
});

module.exports = { router };
