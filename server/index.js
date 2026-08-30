import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_PATH = path.join(__dirname, "data", "db.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { videos: [], comments: [] };
  }
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB cap
  fileFilter: (req, file, cb) =>
    cb(null, file.mimetype.startsWith("video/")),
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" })); // drawings ride along as JSON
app.use("/uploads", express.static(UPLOAD_DIR));

// ---- Videos ----
app.get("/api/videos", (req, res) => {
  const db = loadDb();
  const videos = [...db.videos]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((v) => ({
      ...v,
      commentCount: db.comments.filter((c) => c.videoId === v.id).length,
    }));
  res.json(videos);
});

app.post("/api/videos", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file" });
  const db = loadDb();
  const video = {
    id: crypto.randomUUID(),
    title: req.body.title || req.file.originalname,
    student: req.body.student || "Anonymous",
    notes: req.body.notes || "",
    filename: req.file.filename,
    url: `/uploads/${req.file.filename}`,
    status: "submitted", // submitted | reviewed
    createdAt: new Date().toISOString(),
  };
  db.videos.push(video);
  saveDb(db);
  res.status(201).json(video);
});

app.get("/api/videos/:id", (req, res) => {
  const db = loadDb();
  const video = db.videos.find((v) => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: "Not found" });
  res.json(video);
});

app.patch("/api/videos/:id", (req, res) => {
  const db = loadDb();
  const video = db.videos.find((v) => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: "Not found" });
  if (req.body.status) video.status = req.body.status;
  if (req.body.title) video.title = req.body.title;
  saveDb(db);
  res.json(video);
});

app.delete("/api/videos/:id", (req, res) => {
  const db = loadDb();
  const video = db.videos.find((v) => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: "Not found" });
  db.videos = db.videos.filter((v) => v.id !== video.id);
  db.comments = db.comments.filter((c) => c.videoId !== video.id);
  saveDb(db);
  fs.rm(path.join(UPLOAD_DIR, video.filename), () => {});
  res.json({ ok: true });
});

// ---- Comments (timestamped, optional drawing payload) ----
app.get("/api/videos/:id/comments", (req, res) => {
  const db = loadDb();
  res.json(
    db.comments
      .filter((c) => c.videoId === req.params.id)
      .sort((a, b) => a.time - b.time)
  );
});

app.post("/api/videos/:id/comments", (req, res) => {
  const db = loadDb();
  if (!db.videos.some((v) => v.id === req.params.id))
    return res.status(404).json({ error: "Video not found" });
  const { time, text, author, drawing } = req.body;
  if (typeof time !== "number" || (!text && !drawing))
    return res.status(400).json({ error: "Need a time and text or drawing" });
  const comment = {
    id: crypto.randomUUID(),
    videoId: req.params.id,
    time,
    text: text || "",
    author: author || "Coach",
    drawing: drawing || null, // { strokes: [{color,size,points:[{x,y}...]}] } normalized 0..1
    createdAt: new Date().toISOString(),
  };
  db.comments.push(comment);
  saveDb(db);
  res.status(201).json(comment);
});

app.delete("/api/comments/:id", (req, res) => {
  const db = loadDb();
  db.comments = db.comments.filter((c) => c.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
