"use strict";
/* QuotexBot (QBK): customer accounts + one-time license keys.
 *
 * Fully separate from Flox users: own tables (qbk_accounts / qbk_keys) and
 * own JWTs (payload scope:'qbk'), signed with the same secret/mechanism as
 * src/auth.js. A key is bound to ONE account forever the first time it is
 * redeemed (one-time use); after that the customer logs back in with
 * Gmail + password from any device.
 */

const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");
const { hashPassword, checkPassword } = require("../auth");

const router = express.Router();
const now = () => Date.now();

/* Same JWT secret/mechanism as src/auth.js — payload distinguishes QBK. */
const SECRET = process.env.JWT_SECRET || "flux-dev-secret-change-me";
const EXPIRES = "30d";

function signQbkToken(account) {
  return jwt.sign({ qid: account.id, scope: "qbk" }, SECRET, { expiresIn: EXPIRES });
}

/* Attach req.qbk when a valid QBK Bearer token is present, else 401. */
function requireQbk(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ ok: false, error: "Login required" });
  try {
    const payload = jwt.verify(t, SECRET);
    if (!payload || payload.scope !== "qbk" || !payload.qid)
      return res.status(401).json({ ok: false, error: "Bad or expired token — please log in again" });
    req.qbk = payload;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Bad or expired token — please log in again" });
  }
}

const PLANS = {
  "7D": { plan_name: "Weekly", trades_per_day: 10, days: 7 },
  "30D": { plan_name: "Monthly", trades_per_day: 30, days: 30 },
  "LIFE": { plan_name: "Lifetime", trades_per_day: null, days: null },
};
const LIFE_EXPIRES_ON = 253402300799999; // end of 9999-12-31 (UTC), ms epoch

function publicAccount(a) {
  return { id: a.id, name: a.name, gmail: a.gmail };
}

function subscriptionOf(a) {
  if (!a || !a.plan) return null;
  const p = PLANS[a.plan];
  if (!p) return null;
  const expires = a.plan === "LIFE" ? null : (a.sub_expires == null ? null : Number(a.sub_expires));
  const active = a.plan === "LIFE" || (expires !== null && expires > now());
  return { plan: a.plan, plan_name: p.plan_name, trades_per_day: p.trades_per_day, expires_on: expires, active };
}

/* ---- key scheme: QBK-<D>-<E>-<R>-<C>, C = base36(djb2 % 1679616) ---- */
function keyChecksum(D, E, R) {
  const payload = "QBK|" + D + "|" + E + "|" + R + "|KGF";
  let h = 5381;
  for (let i = 0; i < payload.length; i++) h = ((h * 33) ^ payload.charCodeAt(i)) >>> 0;
  return (h % 1679616).toString(36).toUpperCase().padStart(4, "0");
}
const KEY_RE = /^QBK-(7D|30D|LIFE)-(\d{8})-([A-Z0-9]{6})-([A-Z0-9]{4})$/;
function parseKey(raw) {
  const m = KEY_RE.exec(String(raw || "").trim().toUpperCase());
  if (!m) return null;
  if (keyChecksum(m[1], m[2], m[3]) !== m[4]) return null;
  return { D: m[1], E: m[2], R: m[3], key: m[0] };
}

function fmtYmdUTC(ms) {
  const d = new Date(ms);
  return "" + d.getUTCFullYear()
    + String(d.getUTCMonth() + 1).padStart(2, "0")
    + String(d.getUTCDate()).padStart(2, "0");
}
function endOfYmdMs(ymd) {
  if (ymd === "99991231") return LIFE_EXPIRES_ON;
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 23, 59, 59, 999);
}

const GMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/qbk/signup {name, gmail, password}
router.post("/signup", async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 60);
  const gmail = String(req.body.gmail || "").trim().toLowerCase().slice(0, 120);
  const password = String(req.body.password || "");
  if (!name) return res.status(400).json({ ok: false, error: "Name is required" });
  if (!GMAIL_RE.test(gmail)) return res.status(400).json({ ok: false, error: "Enter a valid Gmail address" });
  if (password.length < 6) return res.status(400).json({ ok: false, error: "Password must be at least 6 characters" });
  const exists = await db.prepare("SELECT id FROM qbk_accounts WHERE gmail=?").get(gmail);
  if (exists) return res.status(409).json({ ok: false, error: "An account with that Gmail already exists" });
  const r = await db.prepare(
    "INSERT INTO qbk_accounts (name, gmail, password_hash, created_at) VALUES (?,?,?,?)"
  ).run(name, gmail, hashPassword(password), now());
  const account = await db.prepare("SELECT * FROM qbk_accounts WHERE id=?").get(r.lastInsertRowid);
  res.json({ ok: true, token: signQbkToken(account), account: publicAccount(account), subscription: subscriptionOf(account) });
});

// POST /api/qbk/login {gmail, password}
router.post("/login", async (req, res) => {
  const gmail = String(req.body.gmail || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const account = await db.prepare("SELECT * FROM qbk_accounts WHERE gmail=?").get(gmail);
  if (!account) return res.status(404).json({ ok: false, error: "No account with that Gmail" });
  if (!checkPassword(password, account.password_hash))
    return res.status(401).json({ ok: false, error: "Wrong password" });
  res.json({ ok: true, token: signQbkToken(account), account: publicAccount(account), subscription: subscriptionOf(account) });
});

// GET /api/qbk/me
router.get("/me", requireQbk, async (req, res) => {
  const account = await db.prepare("SELECT * FROM qbk_accounts WHERE id=?").get(req.qbk.qid);
  if (!account) return res.status(404).json({ ok: false, error: "Account not found" });
  res.json({ ok: true, account: publicAccount(account), subscription: subscriptionOf(account) });
});

// POST /api/qbk/redeem {key} — one-time: first redemption binds the key forever
router.post("/redeem", requireQbk, async (req, res) => {
  const parsed = parseKey(req.body.key);
  if (!parsed) return res.status(400).json({ ok: false, error: "Invalid key" });
  const row = await db.prepare("SELECT * FROM qbk_keys WHERE key=?").get(parsed.key);
  if (!row) return res.status(404).json({ ok: false, error: "This key was not issued by us" });
  if (row.status === "used") return res.status(409).json({ ok: false, error: "This key has already been used" });
  if (row.status === "revoked") return res.status(403).json({ ok: false, error: "This key has been revoked" });
  if (parsed.D !== "LIFE" && now() > endOfYmdMs(parsed.E))
    return res.status(410).json({ ok: false, error: "This key has expired" });
  const subExpires = parsed.D === "LIFE" ? null : endOfYmdMs(parsed.E);
  await db.prepare("UPDATE qbk_accounts SET plan=?, sub_expires=? WHERE id=?")
    .run(parsed.D, subExpires, req.qbk.qid);
  await db.prepare("UPDATE qbk_keys SET status='used', used_by=?, used_at=? WHERE id=?")
    .run(req.qbk.qid, now(), row.id);
  const account = await db.prepare("SELECT * FROM qbk_accounts WHERE id=?").get(req.qbk.qid);
  res.json({ ok: true, subscription: subscriptionOf(account) });
});

/* ---- PC bot signals + remote arm switch ----
 * The PC bot (running on the member's own machine, logged in as the member)
 * reports its REAL signals/results here; the portal's AI Bot section reads
 * them back. bot-state is the portal Start/Stop switch the bot polls:
 * enabled=true arms auto-trading on the bot side. */

// POST /api/qbk/signals {pair, direction, confidence, duration_sec, stake, kind, result?, net?}
router.post("/signals", requireQbk, async (req, res) => {
  const b = req.body || {};
  const pair = String(b.pair || "").trim().slice(0, 40);
  const direction = String(b.direction || "").trim().toUpperCase();
  if (!pair || (direction !== "UP" && direction !== "DOWN"))
    return res.status(400).json({ ok: false, error: "pair and direction (UP or DOWN) are required" });
  const kind = b.kind === "result" ? "result" : "signal";
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const dur = num(b.duration_sec);
  const result = kind === "result" && (b.result === "WIN" || b.result === "LOSS") ? b.result : null;
  await db.prepare(
    "INSERT INTO qbk_signals (qid, pair, direction, confidence, duration_sec, stake, kind, result, net, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(req.qbk.qid, pair, direction, num(b.confidence), dur === null ? null : Math.round(dur),
        num(b.stake), kind, result, kind === "result" ? num(b.net) : null, now());
  // keep only the latest 50 rows per account
  await db.prepare(
    "DELETE FROM qbk_signals WHERE qid=? AND id NOT IN (SELECT id FROM qbk_signals WHERE qid=? ORDER BY id DESC LIMIT 50)"
  ).run(req.qbk.qid, req.qbk.qid);
  res.json({ ok: true });
});

// GET /api/qbk/signals — latest 20 for this account, newest first
router.get("/signals", requireQbk, async (req, res) => {
  const rows = await db.prepare(
    "SELECT pair, direction, confidence, duration_sec, stake, kind, result, net, created_at FROM qbk_signals WHERE qid=? ORDER BY id DESC LIMIT 20"
  ).all(req.qbk.qid);
  res.json({
    ok: true,
    signals: rows.map(r => ({
      pair: r.pair, direction: r.direction, confidence: r.confidence,
      duration_sec: r.duration_sec, stake: r.stake, kind: r.kind,
      result: r.result, net: r.net, created_at: Number(r.created_at),
    })),
  });
});

// GET /api/qbk/bot-state — {enabled} (default false)
router.get("/bot-state", requireQbk, async (req, res) => {
  const row = await db.prepare("SELECT enabled FROM qbk_bot_state WHERE qid=?").get(req.qbk.qid);
  res.json({ ok: true, enabled: !!(row && Number(row.enabled)) });
});

// POST /api/qbk/bot-state {enabled} — portal Start/Stop switch
router.post("/bot-state", requireQbk, async (req, res) => {
  const enabled = req.body && req.body.enabled ? 1 : 0;
  const row = await db.prepare("SELECT id FROM qbk_bot_state WHERE qid=?").get(req.qbk.qid);
  if (row) await db.prepare("UPDATE qbk_bot_state SET enabled=? WHERE qid=?").run(enabled, req.qbk.qid);
  else await db.prepare("INSERT INTO qbk_bot_state (qid, enabled) VALUES (?,?)").run(req.qbk.qid, enabled);
  res.json({ ok: true, enabled: !!enabled });
});

// POST /api/qbk/issue {plan} — admin only, header x-admin-token
router.post("/issue", async (req, res) => {
  const admin = process.env.QBK_ADMIN_TOKEN;
  if (!admin) return res.status(503).json({ ok: false, error: "issuing disabled" });
  if (String(req.headers["x-admin-token"] || "") !== admin)
    return res.status(401).json({ ok: false, error: "Bad admin token" });
  const plan = String(req.body.plan || "").trim().toUpperCase();
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ ok: false, error: "plan must be 7D, 30D or LIFE" });
  const E = plan === "LIFE" ? "99991231" : fmtYmdUTC(now() + p.days * 86400000);
  const expiresOn = plan === "LIFE" ? LIFE_EXPIRES_ON : endOfYmdMs(E);
  const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (let attempt = 0; attempt < 8; attempt++) {
    let R = "";
    for (let i = 0; i < 6; i++) R += CH[crypto.randomInt(CH.length)];
    const key = "QBK-" + plan + "-" + E + "-" + R + "-" + keyChecksum(plan, E, R);
    const clash = await db.prepare("SELECT id FROM qbk_keys WHERE key=?").get(key);
    if (clash) continue;
    await db.prepare(
      "INSERT INTO qbk_keys (key, plan, expires_on, status, created_at) VALUES (?,?,?,?,?)"
    ).run(key, plan, expiresOn, "unused", now());
    return res.json({ ok: true, key, plan, expires_on: expiresOn });
  }
  res.status(500).json({ ok: false, error: "Could not generate a unique key" });
});

module.exports = { router, requireQbk };
