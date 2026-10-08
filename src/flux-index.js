"use strict";
/* Flux backend — Express server. */

const express = require("express");
const cors = require("cors");
const path = require("path");

require("./db"); // creates schema
const db = require("./db");
const { UPLOAD_DIR } = require("./uploads");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// uploaded media
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d" }));

app.get("/api/health", (req, res) => res.json({ ok: true, app: "flux-backend", version: "1.0.0" }));

// admin dashboard website
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.use("/api/auth", require("./routes/auth").router);
app.use("/api", require("./routes/content").router);
app.use("/api", require("./routes/engage").router);
app.use("/api", require("./routes/spaces").router);
app.use("/api", require("./routes/misc").router);
app.use("/api", require("./routes/admin").router);

// multer / upload errors -> clean JSON
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && (err.code === "LIMIT_FILE_SIZE" || /Only video and image/.test(err.message))) {
    const max = process.env.MAX_UPLOAD_MB || "400";
    return res.status(413).json({ ok: false, error: err.code === "LIMIT_FILE_SIZE" ? `File too big (max ${max} MB)` : err.message });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: "Server error" });
});


// public shareable channel page: /@handle (YouTube-style) and /c/:handle
app.get(["/@:handle","/c/:handle"], async (req, res) => {
  try {
    const handle = String(req.params.handle || "").replace(/^@/, "").slice(0, 40);
    const u = await db.prepare("SELECT * FROM users WHERE lower(handle)=lower(?) OR lower(handle)=lower(?)").get(handle, "@" + handle);
    if (!u) return res.status(404).send("<!doctype html><body style='background:#0E0F13;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh'><h1>Channel not found</h1></body>");
    const subs = Number((await db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE channel_id=?").get(u.id)).c);
    const videos = await db.prepare("SELECT title,file_url,thumb_url,views FROM videos WHERE user_id=? AND visibility='Public' ORDER BY created_at DESC LIMIT 24").all(u.id);
    const shorts = await db.prepare("SELECT caption,file_url,thumb_url,views FROM shorts WHERE user_id=? AND visibility='Public' ORDER BY created_at DESC LIMIT 24").all(u.id);
    const esc = x => String(x ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
    const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n);
    const vcard = v => `<div class="card"><video src="${esc(v.file_url)}" ${v.thumb_url?`poster="${esc(v.thumb_url)}"`:''} controls preload="none"></video><b>${esc(v.title)}</b><small>${fmt(v.views||0)} views</small></div>`;
    const scard = x => `<div class="card short"><video src="${esc(x.file_url)}" ${x.thumb_url?`poster="${esc(x.thumb_url)}"`:''} controls preload="none"></video><b>${esc(x.caption)}</b></div>`;
    const av = u.avatar_url ? `<img class="av" src="${esc(u.avatar_url)}">` : `<div class="av" style="background:#7C6CF0">${esc((u.name||"?")[0].toUpperCase())}</div>`;
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(u.name)} on Flux</title><style>
*{box-sizing:border-box;margin:0}body{background:#0E0F13;color:#fff;font-family:system-ui,sans-serif;padding:20px;max-width:960px;margin:auto}
header{display:flex;gap:16px;align-items:center;margin:8px 0 24px}.av{width:76px;height:76px;border-radius:50%;object-fit:cover;display:grid;place-items:center;font-size:32px;font-weight:800}
h1{font-size:22px}.mut{color:#9aa}.brand{color:#7C6CF0;font-weight:800;font-size:14px;letter-spacing:.5px;margin-bottom:14px}
h2{font-size:16px;margin:22px 0 12px;color:#cfd2dc}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.grid.shorts{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.card{background:#17181d;border-radius:12px;overflow:hidden}.card video{width:100%;aspect-ratio:16/9;background:#000;display:block}
.card.short video{aspect-ratio:9/16}.card b{display:block;font-size:13px;padding:8px 10px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card small{display:block;color:#9aa;font-size:11px;padding:0 10px 10px}.empty{color:#9aa;padding:20px 0}
</style></head><body><div class="brand">FLUX</div><header>${av}<div><h1>${esc(u.name)}</h1><div class="mut">${esc(u.handle)} &middot; ${fmt(subs)} subscribers</div>${u.bio?`<div class="mut" style="margin-top:6px">${esc(u.bio)}</div>`:''}</div></header>
<h2>Videos</h2>${videos.length?`<div class="grid">${videos.map(vcard).join('')}</div>`:'<div class="empty">No videos yet.</div>'}
<h2>Shorts</h2>${shorts.length?`<div class="grid shorts">${shorts.map(scard).join('')}</div>`:'<div class="empty">No shorts yet.</div>'}
</body></html>`);
  } catch (e) { console.error(e); res.status(500).send("Server error"); }
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found: " + req.path }));

const PORT = parseInt(process.env.PORT || "3000", 10);
if (require.main === module) {
  db.ready.then(() => app.listen(PORT, () => console.log(`Flux backend listening on http://localhost:${PORT}`)));
}
module.exports = app;
