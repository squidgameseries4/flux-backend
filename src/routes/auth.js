"use strict";
/* Auth: signup, login, me. */

const express = require("express");
const db = require("../db");
const { hashPassword, checkPassword, signToken, required } = require("../auth");

const router = express.Router();
const now = () => Date.now();

function publicUser(u) {
  return { id: u.id, name: u.name, handle: u.handle, avatar_url: u.avatar_url, banner_url: u.banner_url || '', bio: u.bio, created_at: u.created_at };
}

// POST /api/auth/signup {name, handle, password}
router.post("/signup", async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  let handle = String(req.body.handle || "").trim().slice(0, 40);
  const password = String(req.body.password || "");
  if (!name) return res.status(400).json({ ok: false, error: "Name is required" });
  if (!handle) return res.status(400).json({ ok: false, error: "Handle is required" });
  if (!handle.startsWith("@")) handle = "@" + handle;
  if (password.length < 4) return res.status(400).json({ ok: false, error: "Password must be at least 4 characters" });
  const exists = await db.prepare("SELECT id FROM users WHERE lower(handle)=lower(?)").get(handle);
  if (exists) return res.status(409).json({ ok: false, error: "That handle is taken" });
  const r = await db.prepare(
    "INSERT INTO users (name, handle, password_hash, created_at) VALUES (?,?,?,?)"
  ).run(name, handle, hashPassword(password), now());
  const user = await db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid);
  res.json({ ok: true, token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/login {handle, password}
router.post("/login", async (req, res) => {
  const handle = String(req.body.handle || "").trim();
  const password = String(req.body.password || "");
  const user = await db.prepare("SELECT * FROM users WHERE lower(handle)=lower(?)").get(handle);
  if (!user) return res.status(404).json({ ok: false, error: "No account with that username" });
  if (!checkPassword(password, user.password_hash))
    return res.status(401).json({ ok: false, error: "Wrong password" });
  res.json({ ok: true, token: signToken(user), user: publicUser(user) });
});

// GET /api/auth/me
router.get("/me", required, async (req, res) => {
  const user = await db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });
  res.json({ ok: true, user: publicUser(user) });
});

// PATCH /api/auth/me {name, bio, avatar_url}
router.patch("/me", required, async (req, res) => {
  const updates = [], params = [];
  if (req.body.name !== undefined) { const name = String(req.body.name || "").trim().slice(0, 60); if (name) { updates.push("name=?"); params.push(name); } }
  if (req.body.bio !== undefined) { updates.push("bio=?"); params.push(String(req.body.bio || "").trim().slice(0, 300)); }
  if (req.body.avatar_url !== undefined) { updates.push("avatar_url=?"); params.push(String(req.body.avatar_url || "").trim().slice(0, 500)); }
  if (req.body.banner_url !== undefined) { updates.push("banner_url=?"); params.push(String(req.body.banner_url || "").trim().slice(0, 500)); }
  if (updates.length) await db.prepare("UPDATE users SET " + updates.join(", ") + " WHERE id=?").run(...params, req.user.id);
  const user = await db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  res.json({ ok: true, user: publicUser(user) });
});

module.exports = { router, publicUser };
