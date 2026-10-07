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

app.use((req, res) => res.status(404).json({ ok: false, error: "Not found: " + req.path }));

const PORT = parseInt(process.env.PORT || "3000", 10);
if (require.main === module) {
  db.ready.then(() => app.listen(PORT, () => console.log(`Flux backend listening on http://localhost:${PORT}`)));
}
module.exports = app;
