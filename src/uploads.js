"use strict";
/* File uploads: multer -> ./uploads, served at /uploads/<file>. */

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 8) || ".bin";
    const name = Date.now() + "-" + Math.floor(Math.random() * 1e9) + ext;
    cb(null, name);
  },
});

const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || "400", 10);

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(video|image)\//.test(file.mimetype)) return cb(null, true);
    cb(new Error("Only video and image files are allowed"));
  },
});

function fileUrl(req, file) {
  return "/uploads/" + file.filename;
}

module.exports = { upload, fileUrl, UPLOAD_DIR };
