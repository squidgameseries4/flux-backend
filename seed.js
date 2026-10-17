"use strict";
/* Seed the database with thousands of users + content.
   Usage: node scripts/seed.js --users 3000
   Writes directly to the DB (fast). Respects DB_PATH / DATABASE_URL. */

const db = require("../src/db");
const { hashPassword } = require("../src/auth");

const args = process.argv.slice(2);
const N = parseInt((args[args.indexOf("--users") + 1] || "1000"), 10);
const PW = hashPassword("password123");
const now = Date.now();
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

(async () => {
  await db.ready;
  const t0 = Date.now();
  console.log(`Seeding ${N} users...`);

  // users (batched)
  for (let i = 0; i < N; i += 500) {
    const batch = Math.min(500, N - i);
    for (let k = 0; k < batch; k++) {
      const n = i + k;
      await db.prepare("INSERT INTO users (name,handle,password_hash,created_at) VALUES (?,?,?,?)")
        .run("User " + n, "@user" + n + "_" + Math.floor(Math.random() * 1e6), PW, now - rnd(0, 90 * 864e5));
    }
    process.stdout.write(`\r  users: ${Math.min(i + 500, N)}/${N}`);
  }
  console.log("");

  const vids = [], shorts = [], posts = [];
  for (let u = 1; u <= N; u++) {
    const nv = rnd(0, 3);
    for (let k = 0; k < nv; k++) {
      const r = await db.prepare(`INSERT INTO videos (user_id,title,description,file_url,duration,views,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(u, "Vlog #" + u + "-" + k, "seeded video", "/uploads/seed.mp4", rnd(30, 600), rnd(0, 5000), now - rnd(0, 60 * 864e5));
      vids.push(r.lastInsertRowid);
    }
    if (Math.random() < 0.5) {
      const r = await db.prepare(`INSERT INTO shorts (user_id,caption,file_url,duration,views,created_at)
        VALUES (?,?,?,?,?,?)`).run(u, "short " + u, "/uploads/seed.mp4", rnd(10, 60), rnd(0, 9000), now - rnd(0, 60 * 864e5));
      shorts.push(r.lastInsertRowid);
    }
    if (Math.random() < 0.4) {
      const r = await db.prepare("INSERT INTO posts (user_id,text,created_at) VALUES (?,?,?)")
        .run(u, "Hello from user " + u + "! This is a seeded community post.", now - rnd(0, 30 * 864e5));
      posts.push(r.lastInsertRowid);
    }
    if (u % 500 === 0) process.stdout.write(`\r  content: ${u}/${N} users`);
  }
  console.log("");

  // likes + comments + subscriptions (sampled)
  const sample = (arr, n) => { const out = []; for (let i = 0; i < n && arr.length; i++) out.push(arr[rnd(0, arr.length - 1)]); return out; };
  for (let u = 1; u <= N; u++) {
    for (const vid of sample(vids, rnd(0, 4)))
      await db.prepare("INSERT OR IGNORE INTO likes (user_id,target_type,target_id,created_at) VALUES (?,?,?,?)").run(u, "video", vid, now);
    for (const vid of sample(vids, rnd(0, 2)))
      await db.prepare("INSERT INTO comments (user_id,target_type,target_id,text,created_at) VALUES (?,?,?,?,?)").run(u, "video", vid, "Nice video!", now);
    for (let k = 0; k < rnd(0, 3); k++) {
      const ch = rnd(1, N);
      if (ch !== u) await db.prepare("INSERT OR IGNORE INTO subscriptions (subscriber_id,channel_id,created_at) VALUES (?,?,?)").run(u, ch, now);
    }
    if (u % 1000 === 0) process.stdout.write(`\r  engagement: ${u}/${N} users`);
  }
  console.log("");

  // one spaces server with a busy channel
  const srv = await db.prepare("INSERT INTO servers (owner_id,name,created_at) VALUES (?,?,?)").run(1, "Seed Hub", now);
  const ch = await db.prepare("INSERT INTO channels (server_id,name,kind,created_at) VALUES (?,?,?,?)").run(srv.lastInsertRowid, "general", "text", now);
  for (let i = 0; i < Math.min(N, 2000); i++) {
    await db.prepare("INSERT INTO messages (channel_id,user_id,text,created_at) VALUES (?,?,?,?)")
      .run(ch.lastInsertRowid, rnd(1, N), "seeded message " + i, now - rnd(0, 864e5));
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const c = async t => Number((await db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()).c);
  console.log(`\nDone in ${secs}s:`);
  console.log(`  users: ${await c("users")}  videos: ${await c("videos")}  shorts: ${await c("shorts")}`);
  console.log(`  posts: ${await c("posts")}  comments: ${await c("comments")}  likes: ${await c("likes")}  messages: ${await c("messages")}`);
  await db.close();
})().catch(e => { console.error(e); process.exit(1); });
