"use strict";
/* Flox backend — Express server. */

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

// privacy policy (Play Store listing)
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "privacy.html")));

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


/* ---------- landing page ---------- */
app.get("/", async (req, res) => {
  const esc = x => String(x ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  let chans = [];
  try {
    chans = await db.prepare("SELECT u.*, (SELECT COUNT(*) c FROM subscriptions WHERE channel_id=u.id) sc FROM users u ORDER BY sc DESC, u.created_at DESC LIMIT 12").all();
  } catch (e) {}
  const cards = chans.map(c => {
    const av = c.avatar_url ? `<img src="${esc(c.avatar_url)}" alt="">` : `<div class="cav">${esc((c.name || "?")[0].toUpperCase())}</div>`;
    return `<a class="card" href="/@${esc(c.handle.replace(/^@/, ""))}">${av}<div><b>${esc(c.name)}</b><span>@${esc(c.handle.replace(/^@/, ""))} \u00b7 ${c.sc} subscribers</span></div></a>`;
  }).join("");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flox \u2014 Watch. Create. Share.</title><style>
*{box-sizing:border-box}body{margin:0;background:#0E0F13;color:#fff;font-family:Inter,system-ui,sans-serif}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;max-width:1100px;margin:auto}
.brand{color:#7C6CF0;font-weight:800;font-size:16px;letter-spacing:.5px;text-decoration:none}
.hero{max-width:1100px;margin:auto;padding:70px 22px 40px;text-align:center}
.hero h1{font-size:42px;margin:0 0 12px;line-height:1.15}
.hero h1 span{color:#7C6CF0}
.hero p{color:#9aa0ae;font-size:17px;max-width:560px;margin:0 auto 28px}
.cta{display:inline-block;background:#7C6CF0;color:#fff;font-weight:700;padding:14px 34px;border-radius:999px;text-decoration:none;font-size:16px}
.sec{max-width:1100px;margin:auto;padding:30px 22px 60px}
.sec h2{font-size:20px;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.card{display:flex;gap:12px;align-items:center;background:#17181d;border-radius:14px;padding:14px;text-decoration:none;color:#fff}
.card img,.cav{width:52px;height:52px;border-radius:50%;object-fit:cover;flex:none}
.cav{display:grid;place-items:center;background:#7C6CF0;font-weight:800;font-size:22px}
.card b{display:block;font-size:15px}
.card span{color:#9aa0ae;font-size:13px}
.empty{color:#9aa0ae;text-align:center;padding:30px}
.foot{text-align:center;color:#5b606c;font-size:13px;padding:26px}
</style></head><body>
<div class="topbar"><a class="brand" href="/">FLUX</a></div>
<div class="hero"><h1>Watch. Create. <span>Share.</span></h1>
<p>Flox is a home for creators \u2014 upload videos and shorts, build your channel, and grow your audience.</p>
<a class="cta" href="#channels">Browse channels</a></div>
<div class="sec" id="channels"><h2>Channels</h2><div class="grid">${cards || `<div class="empty">No channels yet \u2014 be the first.</div>`}</div></div>
<div class="foot">\u00a9 2026 Flox</div></body></html>`);
});

// public shareable channel page: /@handle (YouTube-style) and /c/:handle
app.get(["/@:handle","/c/:handle"], async (req, res) => {
  try {
    const handle = String(req.params.handle || "").replace(/^@/, "").slice(0, 40);
    const u = await db.prepare("SELECT * FROM users WHERE lower(handle)=lower(?) OR lower(handle)=lower(?)").get(handle, "@" + handle);
    if (!u) return res.status(404).send("<!doctype html><body style='background:#0E0F13;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh'><h1>Channel not found</h1></body>");
    const esc = x => String(x ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
    const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n);
    const subs = Number((await db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE channel_id=?").get(u.id)).c);
    const videos = await db.prepare("SELECT id,title,file_url,thumb_url,views,created_at FROM videos WHERE user_id=? AND visibility='Public' ORDER BY created_at DESC LIMIT 24").all(u.id);
    const shorts = await db.prepare("SELECT id,caption,file_url,thumb_url,views,created_at FROM shorts WHERE user_id=? AND visibility='Public' ORDER BY created_at DESC LIMIT 24").all(u.id);
    const posts = await db.prepare("SELECT text,created_at FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 20").all(u.id);
    const pls = await db.prepare("SELECT id,name FROM playlists WHERE user_id=? ORDER BY created_at DESC LIMIT 12").all(u.id);
    for (const pl of pls) {
      const items = await db.prepare("SELECT target_type,target_id FROM playlist_items WHERE playlist_id=? ORDER BY created_at LIMIT 12").all(pl.id);
      pl.items = [];
      for (const it of items) {
        const isShort = it.target_type === "short";
        const row = await db.prepare("SELECT " + (isShort ? "caption AS title" : "title") + ",thumb_url,file_url FROM " + (isShort ? "shorts" : "videos") + " WHERE id=?").get(it.target_id);
        if (row) pl.items.push(row);
      }
    }
    const vcard = v => `<div class="card"><video src="${esc(v.file_url)}" ${v.thumb_url?`poster="${esc(v.thumb_url)}"`:''} controls preload="none"></video><b>${esc(v.title)}</b><small>${fmt(v.views||0)} views</small></div>`;
    const scard = x => `<div class="card short"><video src="${esc(x.file_url)}" ${x.thumb_url?`poster="${esc(x.thumb_url)}"`:''} controls preload="none"></video><b>${esc(x.caption)}</b><small>${fmt(x.views||0)} views</small></div>`;
    const pcard = p => `<div class="post"><div class="phead">${avSm}<b>${esc(u.name)}</b></div><p>${esc(p.text)}</p></div>`;
    const av = u.avatar_url ? `<img class="av" src="${esc(u.avatar_url)}" alt="">` : `<div class="av" style="background:#7C6CF0">${esc((u.name||"?")[0].toUpperCase())}</div>`;
    const avSm = u.avatar_url ? `<img class="avsm" src="${esc(u.avatar_url)}" alt="">` : `<div class="avsm" style="background:#7C6CF0">${esc((u.name||"?")[0].toUpperCase())}</div>`;
    const bio = u.bio || "";
    const bioHtml = !bio ? "" : bio.length <= 120 ? `<div class="bio">${esc(bio)}</div>`
      : `<div class="bio"><span id="bshort">${esc(bio.slice(0,120))}&hellip; <button class="more" onclick="bd(1)">...more</button></span><span id="bfull" style="display:none">${esc(bio)} <button class="more" onclick="bd(0)">Show less</button></span></div>`;
    const plHtml = pls.length ? pls.map(pl => `<div class="pl"><div class="plhead"><b>${esc(pl.name)}</b><small>${pl.items.length} videos</small></div>` +
      (pl.items.length ? `<div class="grid">${pl.items.map(v => `<div class="card"><video src="${esc(v.file_url)}" ${v.thumb_url?`poster="${esc(v.thumb_url)}"`:''} controls preload="none"></video><b>${esc(v.title)}</b></div>`).join('')}</div>` : `<div class="empty">Empty playlist.</div>`) + `</div>`).join('')
      : `<div class="empty">No playlists yet.</div>`;
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(u.name)} on Flox</title><style>
*{box-sizing:border-box;margin:0}body{background:#0E0F13;color:#fff;font-family:system-ui,sans-serif}
.wrap{max-width:1000px;margin:auto;padding:16px 20px 40px}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;max-width:1000px;margin:auto}
.brand{color:#7C6CF0;font-weight:800;font-size:15px;letter-spacing:.5px}
.sharebtn{background:none;border:0;color:#cfd2dc;cursor:pointer;padding:8px}
.banner{width:100%;max-height:160px;overflow:hidden;background:#17181d;border-radius:12px}.banner img{width:100%;height:100%;max-height:160px;object-fit:cover;display:block;border-radius:12px}
.chead{display:flex;gap:16px;align-items:flex-start}
.av{width:88px;height:88px;border-radius:50%;object-fit:cover;display:grid;place-items:center;font-size:36px;font-weight:800;flex:none}
.avsm{width:36px;height:36px;border-radius:50%;object-fit:cover;display:grid;place-items:center;font-size:15px;font-weight:800;flex:none}
.cinfo{flex:1;min-width:0}h1{font-size:24px}.mut{color:#9aa;font-size:13px;margin-top:4px}
.bio{color:#cfd2dc;font-size:13.5px;margin-top:8px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.more{background:none;border:0;color:#9aa;font-weight:700;cursor:pointer;padding:0;font-size:13px}
.subbtn{background:#fff;color:#0E0F13;border:0;border-radius:99px;padding:10px 22px;font-weight:700;font-size:14px;cursor:pointer;flex:none;margin-top:6px}
.tabs{display:flex;gap:4px;margin-top:18px;border-bottom:1px solid #26272e;overflow-x:auto;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}
.tab{background:none;border:0;color:#9aa;font-size:14px;font-weight:600;padding:12px 14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.tab.on{color:#fff;border-bottom-color:#fff}
h2{font-size:16px;margin:22px 0 12px;color:#cfd2dc}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.grid.shorts{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.card{background:#17181d;border-radius:12px;overflow:hidden}.card video{width:100%;aspect-ratio:16/9;background:#000;display:block}
.card.short video{aspect-ratio:9/16}.card b{display:block;font-size:13px;padding:8px 10px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card small{display:block;color:#9aa;font-size:11px;padding:0 10px 10px}.empty{color:#9aa;padding:20px 0}
.pl{margin-bottom:26px}.plhead{margin:22px 0 12px}.plhead b{font-size:16px}.plhead small{color:#9aa;margin-left:8px;font-size:12px}
.post{background:#17181d;border-radius:12px;padding:14px;margin-bottom:12px}.phead{display:flex;align-items:center;gap:10px;margin-bottom:8px}.post p{font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:#e6e8ee}
#toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);background:#26272e;color:#fff;padding:12px 20px;border-radius:99px;font-size:13px;opacity:0;transition:.25s;pointer-events:none;max-width:90vw;text-align:center}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
</style></head><body><div class="topbar"><a class="brand" href="/" style="text-decoration:none">FLUX</a><button class="sharebtn" onclick="sharePage()" aria-label="Share channel"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg></button></div>${u.banner_url?`<div class="banner"><img src="${esc(u.banner_url)}" alt=""></div>`:``}<div class="wrap">
<div class="chead">${av}<div class="cinfo"><h1>${esc(u.name)}</h1><div class="mut">${esc(u.handle)} &middot; ${fmt(subs)} subscribers &middot; ${videos.length + shorts.length} videos</div>${bioHtml}</div><button class="subbtn" onclick="sub()">Subscribe</button></div>
<div class="tabs"><button class="tab on" data-k="home" onclick="tab('home')">Home</button><button class="tab" data-k="videos" onclick="tab('videos')">Videos</button><button class="tab" data-k="shorts" onclick="tab('shorts')">Shorts</button><button class="tab" data-k="playlists" onclick="tab('playlists')">Playlists</button><button class="tab" data-k="posts" onclick="tab('posts')">Posts</button></div>
<div class="pane" id="pane-home"><h2>Latest videos</h2>${videos.length?`<div class="grid">${videos.slice(0,6).map(vcard).join('')}</div>`:'<div class="empty">No videos yet.</div>'}<h2>Shorts</h2>${shorts.length?`<div class="grid shorts">${shorts.slice(0,6).map(scard).join('')}</div>`:'<div class="empty">No shorts yet.</div>'}</div>
<div class="pane" id="pane-videos" style="display:none"><h2>Videos</h2>${videos.length?`<div class="grid">${videos.map(vcard).join('')}</div>`:'<div class="empty">No videos yet.</div>'}</div>
<div class="pane" id="pane-shorts" style="display:none"><h2>Shorts</h2>${shorts.length?`<div class="grid shorts">${shorts.map(scard).join('')}</div>`:'<div class="empty">No shorts yet.</div>'}</div>
<div class="pane" id="pane-playlists" style="display:none">${plHtml}</div>
<div class="pane" id="pane-posts" style="display:none"><h2>Posts</h2>${posts.length?posts.map(pcard).join(''):'<div class="empty">No posts yet.</div>'}</div>
</div><div id="toast"></div>
<script>
function tab(k){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.k===k));document.querySelectorAll('.pane').forEach(p=>p.style.display=p.id==='pane-'+k?'':'none');window.scrollTo(0,0);}
function bd(f){document.getElementById('bshort').style.display=f?'none':'';document.getElementById('bfull').style.display=f?'':'none';}
function sharePage(){var u=location.href;if(navigator.share){navigator.share({title:document.title,url:u}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(u);var t=document.getElementById('toast');t.textContent='Link copied';t.className='show';setTimeout(function(){t.className='';},2000);}}
function sub(){var t=document.getElementById('toast');t.textContent='Open the Flox app and log in to subscribe to this channel';t.className='show';setTimeout(function(){t.className='';},2600);}
</script></body></html>`);
  } catch (e) { console.error(e); res.status(500).send("Server error"); }
});

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found: " + req.path }));

const PORT = parseInt(process.env.PORT || "3000", 10);
if (require.main === module) {
  db.ready.then(() => app.listen(PORT, () => console.log(`Flox backend listening on http://localhost:${PORT}`)));
}
module.exports = app;
