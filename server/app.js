import dotenv from "dotenv";
// .env.local (from `vercel env pull`) carries VERCEL_OIDC_TOKEN + Blob vars
dotenv.config({ path: ".env.local" });
dotenv.config();
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { handleUploadPresigned } from "@vercel/blob/client";
import { del, issueSignedToken } from "@vercel/blob";
import { User, Video, Comment } from "./models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const COOKIE = "bc_token";

// Cached connection so serverless invocations reuse it
let dbPromise = null;
export function ensureDb() {
  if (!dbPromise) {
    const uri =
      process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/coachingapp";
    dbPromise = mongoose.connect(uri);
  }
  return dbPromise;
}

export const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "4mb" })); // drawings ride along as JSON
app.use(cookieParser());
// Legacy local uploads (pre-Blob videos in dev)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api", (req, res, next) => {
  ensureDb().then(() => next(), next);
});

// ---- Auth ----
function setSession(res, user) {
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || !!process.env.VERCEL,
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

async function requireAuth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies[COOKIE], JWT_SECRET);
    req.user = await User.findById(id);
    if (!req.user) throw new Error();
    next();
  } catch {
    res.status(401).json({ error: "Not signed in" });
  }
}

app.post("/api/auth/signup", async (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password)
    return res.status(400).json({ error: "Email, name and password required" });
  if (password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });
  if (await User.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ error: "An account with that email exists" });
  const user = await User.create({
    email,
    name,
    passwordHash: await bcrypt.hash(password, 10),
    role: role === "coach" ? "coach" : "student",
  });
  setSession(res, user);
  res.status(201).json(user);
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || "").toLowerCase() });
  if (user && !user.passwordHash)
    return res
      .status(401)
      .json({ error: "This account uses email sign-in — use the link option" });
  if (!user || !(await bcrypt.compare(password || "", user.passwordHash)))
    return res.status(401).json({ error: "Wrong email or password" });
  setSession(res, user);
  res.json(user);
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json(req.user));

// ---- Passwordless (magic link) ----
// The link carries a short-lived JWT. Without RESEND_API_KEY the link is
// printed to the server console instead of emailed (free dev mode).
async function sendMagicEmail(email, link) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n🔗 Magic sign-in link for ${email}:\n${link}\n`);
    return { dev: true };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "Beta Coach <onboarding@resend.dev>",
      to: email,
      subject: "Your Beta Coach sign-in link",
      html: `<p>Click to sign in to Beta Coach:</p><p><a href="${link}">Sign in</a></p><p>This link expires in 15 minutes.</p>`,
    }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.message || "Email send failed");
  }
  return { dev: false };
}

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:5173";
}

app.post("/api/auth/magic-link", async (req, res) => {
  const { email, name, role } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (!existing && !name)
    return res.status(404).json({ error: "new-user" }); // client then asks for name/role
  const token = jwt.sign(
    { magic: true, email: email.toLowerCase(), name, role },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
  const link = `${appUrl(req)}/api/auth/magic?token=${token}`;
  try {
    const { dev } = await sendMagicEmail(email, link);
    res.json({ ok: true, dev });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/auth/magic", async (req, res) => {
  try {
    const payload = jwt.verify(req.query.token, JWT_SECRET);
    if (!payload.magic) throw new Error();
    let user = await User.findOne({ email: payload.email });
    if (!user)
      user = await User.create({
        email: payload.email,
        name: payload.name || payload.email.split("@")[0],
        role: payload.role === "coach" ? "coach" : "student",
      });
    setSession(res, user);
    res.redirect("/");
  } catch {
    res
      .status(400)
      .send("This sign-in link is invalid or expired. Request a new one.");
  }
});

// ---- Video upload (browser → Vercel Blob directly; bypasses the 4.5MB
// serverless body limit). Presigned flow: works with OIDC auth (BLOB_STORE_ID
// + VERCEL_OIDC_TOKEN), no static read-write token needed. The client gets a
// presigned PUT URL here, uploads to Blob, then registers the video via
// POST /api/videos with the blob URL.
app.post("/api/blob/upload", requireAuth, async (req, res) => {
  try {
    const jsonResponse = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname) => ({
        // requireAuth already verified the user above
        token: await issueSignedToken({
          pathname,
          operations: ["put"],
          maximumSizeInBytes: 200 * 1024 * 1024,
          validUntil: Date.now() + 60 * 60 * 1000,
        }),
        urlOptions: {
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
          allowOverwrite: false,
        },
      }),
      onUploadCompleted: async () => {}, // registration happens via POST /api/videos
    });
    res.json(jsonResponse);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Videos ----
// Students see only their own uploads; coaches see everyone's.
app.get("/api/videos", requireAuth, async (req, res) => {
  const filter = req.user.role === "coach" ? {} : { owner: req.user.id };
  const videos = await Video.find(filter).sort({ createdAt: -1 });
  const counts = await Comment.aggregate([
    { $match: { video: { $in: videos.map((v) => v._id) } } },
    { $group: { _id: "$video", n: { $sum: 1 } } },
  ]);
  const byId = Object.fromEntries(counts.map((c) => [c._id.toString(), c.n]));
  res.json(
    videos.map((v) => ({ ...v.toJSON(), commentCount: byId[v.id] || 0 }))
  );
});

app.post("/api/videos", requireAuth, async (req, res) => {
  const { title, notes, url } = req.body;
  if (!url) return res.status(400).json({ error: "No video URL" });
  const video = await Video.create({
    owner: req.user.id,
    title: title || "Untitled climb",
    student: req.user.name,
    notes: notes || "",
    url,
  });
  res.status(201).json(video);
});

// A student may only open their own video; a coach may open any.
async function loadVideo(req, res, next) {
  const video = await Video.findById(req.params.id).catch(() => null);
  if (!video) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "coach" && !video.owner.equals(req.user.id))
    return res.status(403).json({ error: "Not your video" });
  req.video = video;
  next();
}

app.get("/api/videos/:id", requireAuth, loadVideo, (req, res) =>
  res.json(req.video)
);

app.patch("/api/videos/:id", requireAuth, loadVideo, async (req, res) => {
  if (req.body.status && req.user.role === "coach")
    req.video.status = req.body.status;
  if (req.body.title) req.video.title = req.body.title;
  await req.video.save();
  res.json(req.video);
});

app.delete("/api/videos/:id", requireAuth, loadVideo, async (req, res) => {
  await Comment.deleteMany({ video: req.video.id });
  await req.video.deleteOne();
  if (req.video.url?.startsWith("https://"))
    await del(req.video.url).catch(() => {});
  res.json({ ok: true });
});

// ---- Comments (timestamped, optional drawing payload) ----
app.get(
  "/api/videos/:id/comments",
  requireAuth,
  loadVideo,
  async (req, res) => {
    res.json(await Comment.find({ video: req.video.id }).sort({ time: 1 }));
  }
);

app.post(
  "/api/videos/:id/comments",
  requireAuth,
  loadVideo,
  async (req, res) => {
    const { time, text, drawing } = req.body;
    if (typeof time !== "number" || (!text && !drawing))
      return res.status(400).json({ error: "Need a time and text or drawing" });
    const comment = await Comment.create({
      video: req.video.id,
      user: req.user.id,
      author: req.user.name,
      time,
      text: text || "",
      drawing: drawing || null, // { strokes: [{color,size,points:[{x,y}...]}] } normalized 0..1
    });
    res.status(201).json(comment);
  }
);

app.delete("/api/comments/:id", requireAuth, async (req, res) => {
  const comment = await Comment.findById(req.params.id).catch(() => null);
  if (!comment) return res.status(404).json({ error: "Not found" });
  if (req.user.role !== "coach" && !comment.user.equals(req.user.id))
    return res.status(403).json({ error: "Not your comment" });
  await comment.deleteOne();
  res.json({ ok: true });
});
