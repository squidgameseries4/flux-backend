"use strict";
/* Integration test: boots the real server on a temp port + temp DB and
   exercises every major endpoint. Run: npm test */

const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flux-test-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.JWT_SECRET = "test-secret";
process.env.PORT = "0";

const app = require("../src/index");
const server = app.listen(0);
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}`;

let passed = 0, failed = 0;
const results = [];
function check(name, cond, extra) {
  if (cond) { passed++; results.push("PASS " + name); }
  else { failed++; results.push("FAIL " + name + (extra ? " :: " + extra : "")); }
}
async function api(method, p, { token, body, form, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.authorization = "Bearer " + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  let json = null;
  try { json = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, json };
}
function fakeVideo() {
  const form = new FormData();
  form.append("file", new Blob([Buffer.alloc(2048, 7)], { type: "video/mp4" }), "clip.mp4");
  form.append("title", "My test vlog");
  form.append("description", "hello world");
  form.append("duration", "61.5");
  return form;
}

(async () => {
  try {
    // health
    let r = await api("GET", "/api/health");
    check("health", r.status === 200 && r.json.ok);

    // signup
    r = await api("POST", "/api/auth/signup", { body: { name: "Test User", handle: "@tester", password: "secret123" } });
    check("signup", r.status === 200 && r.json.ok && r.json.token, JSON.stringify(r.json));
    const token = r.json.token, meId = r.json.user.id;
    check("signup handle normalized", r.json.user.handle === "@tester");

    // duplicate handle rejected
    r = await api("POST", "/api/auth/signup", { body: { name: "Dup", handle: "@tester", password: "secret123" } });
    check("duplicate handle 409", r.status === 409);

    // login
    r = await api("POST", "/api/auth/login", { body: { handle: "@tester", password: "secret123" } });
    check("login", r.status === 200 && r.json.ok && r.json.token);
    const token2 = r.json.token;

    // bad password
    r = await api("POST", "/api/auth/login", { body: { handle: "@tester", password: "nope" } });
    check("bad password 401", r.status === 401);

    // me
    r = await api("GET", "/api/auth/me", { token });
    check("me", r.status === 200 && r.json.user.handle === "@tester");

    // me without token
    r = await api("GET", "/api/auth/me");
    check("me no-auth 401", r.status === 401);

    // second user
    r = await api("POST", "/api/auth/signup", { body: { name: "Zara", handle: "@zara", password: "secret123" } });
    const zaraToken = r.json.token, zaraId = r.json.user.id;
    check("second user", r.status === 200 && !!zaraToken);

    // video upload
    r = await api("POST", "/api/videos", { token, form: fakeVideo() });
    check("video upload", r.status === 201 && r.json.ok && r.json.video.title === "My test vlog", JSON.stringify(r.json).slice(0, 200));
    const vid = r.json.video.id;
    check("video file_url served path", r.json.video.file_url.startsWith("/uploads/"));

    // get video
    r = await api("GET", "/api/videos/" + vid);
    check("get video", r.status === 200 && r.json.video.likes === 0);

    // view increments
    await api("POST", "/api/videos/" + vid + "/view");
    await api("POST", "/api/videos/" + vid + "/view");
    r = await api("GET", "/api/videos/" + vid);
    check("views increment", r.json.video.views === 2, "views=" + r.json.video.views);

    // like by zara -> notification for owner
    r = await api("POST", "/api/likes", { token: zaraToken, body: { target_type: "video", target_id: vid } });
    check("like", r.status === 200 && r.json.likes === 1);
    r = await api("GET", "/api/videos/" + vid, { token });
    check("liked_by_me for zara", (await api("GET", "/api/videos/" + vid, { token: zaraToken })).json.video.liked_by_me === true);

    // unlike
    r = await api("DELETE", "/api/likes", { token: zaraToken, body: { target_type: "video", target_id: vid } });
    check("unlike", r.status === 200 && r.json.likes === 0);

    // comment
    r = await api("POST", "/api/comments", { token: zaraToken, body: { target_type: "video", target_id: vid, text: "Nice vlog!" } });
    check("comment", r.status === 201 && r.json.comment.text === "Nice vlog!");
    const cid = r.json.comment.id;
    r = await api("GET", `/api/comments?target_type=video&target_id=${vid}`);
    check("list comments", r.json.comments.length === 1 && r.json.comments[0].author.handle === "@zara");
    r = await api("DELETE", "/api/comments/" + cid, { token });
    check("delete others comment 403", r.status === 403);
    r = await api("DELETE", "/api/comments/" + cid, { token: zaraToken });
    check("delete own comment", r.status === 200);

    // subscribe
    r = await api("POST", "/api/subscriptions/" + zaraId, { token });
    check("subscribe", r.status === 200 && r.json.subscribed === true);
    r = await api("GET", "/api/subscriptions/me", { token });
    check("my subscriptions", r.json.channels.length === 1 && r.json.channels[0].handle === "@zara");
    r = await api("DELETE", "/api/subscriptions/" + zaraId, { token });
    check("unsubscribe", r.status === 200 && r.json.subscribed === false);

    // notifications (like + comment + subscribe created some)
    r = await api("GET", "/api/notifications", { token });
    check("notifications arrived", r.json.unread >= 2 && r.json.notifications.length >= 2, "unread=" + r.json.unread);
    r = await api("POST", "/api/notifications/read", { token });
    check("mark read", r.status === 200);
    r = await api("GET", "/api/notifications", { token });
    check("unread cleared", r.json.unread === 0);

    // playlists
    r = await api("POST", "/api/playlists", { token, body: { name: "Favs" } });
    check("create playlist", r.status === 201);
    const plId = r.json.playlist.id;
    r = await api("POST", `/api/playlists/${plId}/items`, { token, body: { target_type: "video", target_id: vid } });
    check("add playlist item", r.status === 201);
    const itemId = r.json.item.id;
    r = await api("GET", "/api/playlists", { token });
    check("list playlists with items", r.json.playlists[0].items.length === 1);
    r = await api("DELETE", `/api/playlists/${plId}/items/${itemId}`, { token });
    check("remove playlist item", r.status === 200);
    r = await api("DELETE", "/api/playlists/" + plId, { token });
    check("delete playlist", r.status === 200);

    // shorts
    const sf = new FormData();
    sf.append("file", new Blob([Buffer.alloc(1024, 3)], { type: "video/mp4" }), "s.mp4");
    sf.append("caption", "quick edit");
    r = await api("POST", "/api/shorts", { token, form: sf });
    check("short upload", r.status === 201 && r.json.short.caption === "quick edit");
    const sid = r.json.short.id;

    // posts
    r = await api("POST", "/api/posts", { token, body: { text: "Hello Flux!" } });
    check("create post", r.status === 201);
    const pid = r.json.post.id;
    r = await api("GET", "/api/posts");
    check("list posts", r.json.posts.length === 1);
    r = await api("DELETE", "/api/posts/" + pid, { token: zaraToken });
    check("delete others post 403", r.status === 403);
    r = await api("DELETE", "/api/posts/" + pid, { token });
    check("delete own post", r.status === 200);

    // feed + search
    r = await api("GET", "/api/feed");
    check("feed mixed", r.json.feed.length === 2 && r.json.feed.some(x => x.kind === "video") && r.json.feed.some(x => x.kind === "short"));
    r = await api("GET", "/api/search?q=vlog");
    check("search videos", r.json.videos.length === 1);
    r = await api("GET", "/api/search?q=zara");
    check("search users", r.json.users.length === 1);

    // user profile
    r = await api("GET", "/api/users/" + meId, { token: zaraToken });
    check("user profile", r.json.user.subscribers === 0 && r.json.videos.length === 1);

    // spaces
    r = await api("POST", "/api/servers", { token, body: { name: "Gaming Hub" } });
    check("create server", r.status === 201);
    const srvId = r.json.server.id;
    r = await api("GET", "/api/servers/" + srvId + "/channels", { token });
    check("default channels", r.json.channels.length === 3);
    r = await api("POST", "/api/servers/" + srvId + "/channels", { token, body: { name: "Clips" } });
    check("create channel", r.status === 201);
    const chId = r.json.channel.id;
    r = await api("POST", "/api/channels/" + chId + "/messages", { token, body: { text: "hey all" } });
    check("send text message", r.status === 201 && r.json.message.text === "hey all");
    const mf = new FormData();
    mf.append("file", new Blob([Buffer.alloc(512, 9)], { type: "image/png" }), "pic.png");
    mf.append("text", "look at this");
    r = await api("POST", "/api/channels/" + chId + "/messages", { token, form: mf });
    check("send file message", r.status === 201 && r.json.message.file_type === "image");
    const mid = r.json.message.id;
    r = await api("GET", "/api/channels/" + chId + "/messages", { token });
    check("list messages", r.json.messages.length === 2 && r.json.messages[1].author.handle === "@tester");
    r = await api("DELETE", "/api/messages/" + mid, { token: zaraToken });
    check("delete others message 403", r.status === 403);
    r = await api("DELETE", "/api/messages/" + mid, { token });
    check("delete own message", r.status === 200);

    // video delete (owner) + file cleanup
    const filePath = path.join(tmp, "uploads", r && "");
    r = await api("DELETE", "/api/videos/" + vid, { token: zaraToken });
    check("delete others video 403", r.status === 403);
    r = await api("GET", "/api/videos/" + vid, { token });
    const diskFile = path.join(tmp, "uploads", path.basename(r.json.video.file_url));
    check("uploaded file on disk", fs.existsSync(diskFile));
    r = await api("DELETE", "/api/videos/" + vid, { token });
    check("delete own video", r.status === 200);
    check("file cleaned up", !fs.existsSync(diskFile));
    r = await api("GET", "/api/videos/" + vid);
    check("video gone", r.status === 404);

    // static file serving
    r = await api("POST", "/api/shorts", { token, form: (() => { const f = new FormData(); f.append("file", new Blob([Buffer.from("hello")], { type: "video/mp4" }), "x.mp4"); f.append("caption", "c"); return f; })() });
    const url = r.json.short.file_url;
    const gr = await fetch(BASE + url);
    check("static file serves", gr.status === 200 && (await gr.text()) === "hello");

    // bad upload rejected
    const bf = new FormData();
    bf.append("file", new Blob(["text"], { type: "text/plain" }), "a.txt");
    r = await api("POST", "/api/videos", { token, form: bf });
    check("non-media upload rejected", r.status === 413 || r.status === 500);

    // ---- admin dashboard ----
    const ah = t => ({ "x-admin-token": t });
    r = await api("GET", "/api/admin/stats", { headers: undefined });
    check("admin stats no-auth 401", (await api("GET", "/api/admin/stats")).status === 401);
    r = await api("POST", "/api/admin/login", { body: { key: "wrong" } });
    check("admin bad key 401", r.status === 401);
    r = await api("POST", "/api/admin/login", { body: { key: "flux-admin-123" } });
    check("admin login", r.status === 200 && !!r.json.token);
    const atok = r.json.token;
    const ax = (m, p, o = {}) => api(m, "/api/admin/" + p, { ...o, headers: ah(atok) });
    r = await ax("GET", "stats");
    check("admin stats", r.status === 200 && (r.json.stats.engine === "sqlite" || r.json.stats.engine === "postgres") && r.json.signups_by_day.length === 14, JSON.stringify(r.json).slice(0, 150));
    r = await ax("GET", "users?q=test");
    check("admin users search", r.json.total >= 1 && r.json.users[0].handle === "@tester");
    r = await ax("GET", "videos");
    check("admin videos list", r.status === 200 && r.json.ok && Array.isArray(r.json.videos));
    r = await ax("DELETE", "videos/" + sid);
    check("admin delete short-as-video 404-ok", r.status === 200);
    r = await ax("GET", "shorts");
    const admShort = r.json.shorts[0].id;
    r = await ax("DELETE", "shorts/" + admShort);
    check("admin delete short", r.status === 200);
    r = await ax("DELETE", "users/" + zaraId);
    check("admin delete user", r.status === 200);
    r = await api("GET", "/api/users/" + zaraId);
    check("deleted user gone", r.status === 404);
  } catch (e) {
    failed++;
    results.push("FAIL exception: " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e));
  } finally {
    server.close();
  }
  console.log(results.join("\n"));
  console.log(`\n${passed} passed, ${failed} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
