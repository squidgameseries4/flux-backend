"use strict";
/* Password hashing (bcryptjs) + JWT sessions. */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "flux-dev-secret-change-me";
const EXPIRES = "30d";

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
function checkPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}
function signToken(user) {
  return jwt.sign({ id: user.id, handle: user.handle }, SECRET, { expiresIn: EXPIRES });
}
/* Attach req.user when a valid Bearer token is present, else 401. */
function required(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ ok: false, error: "Login required" });
  try {
    req.user = jwt.verify(t, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Bad or expired token — please log in again" });
  }
}
/* Attach req.user when possible, never rejects. */
function optional(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (t) {
    try { req.user = jwt.verify(t, SECRET); } catch (e) { /* ignore */ }
  }
  next();
}

module.exports = { hashPassword, checkPassword, signToken, required, optional };
