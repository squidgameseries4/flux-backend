const express = require("express");
const db = require("../db");
const { required, optional } = require("../auth");

const router = express.Router();
const now = () => Date.now();

// GET /api/jobs — list all jobs & services with poster info
router.get("/", optional, async (req, res) => {
  const rows = await db.prepare(`
    SELECT j.*, u.name as poster_name, u.handle as poster_handle
    FROM jobs j JOIN users u ON u.id = j.user_id
    ORDER BY j.created_at DESC LIMIT 100`).all();
  res.json({ ok: true, jobs: rows.map(j => ({
    id: j.id, kind: j.kind, title: j.title, company: j.company,
    location: j.location, salary: j.salary, job_type: j.job_type,
    description: j.description, created_at: j.created_at,
    poster: { id: j.user_id, name: j.poster_name, handle: j.poster_handle },
    mine: req.user ? j.user_id === req.user.id : false
  }))});
});

// POST /api/jobs — post a job or service
router.post("/", required, async (req, res) => {
  const kind = req.body.kind === "service" ? "service" : "job";
  const title = String(req.body.title || "").trim().slice(0, 100);
  if (!title) return res.status(400).json({ ok: false, error: "Title required" });
  const company = String(req.body.company || "").trim().slice(0, 100);
  const location = String(req.body.location || "").trim().slice(0, 100);
  const salary = String(req.body.salary || "").trim().slice(0, 50);
  const job_type = String(req.body.job_type || "").trim().slice(0, 50);
  const description = String(req.body.description || "").trim().slice(0, 2000);
  const r = await db.prepare(
    "INSERT INTO jobs (user_id, kind, title, company, location, salary, job_type, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(req.user.id, kind, title, company, location, salary, job_type, description, now());
  const id = r.lastID || r.id;
  res.json({ ok: true, job: { id, kind, title } });
});

// DELETE /api/jobs/:id — delete own job/service
router.delete("/:id", required, async (req, res) => {
  const j = await db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id);
  if (!j) return res.status(404).json({ ok: false, error: "Not found" });
  if (j.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "Not yours" });
  await db.prepare("DELETE FROM jobs WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = { router };
