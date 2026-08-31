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
import { User, Video, Comment, Route, Send } from "./models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const COOKIE = "bc_token";

// Only these emails become coaches; everyone else signs up as a student
const COACH_EMAILS = (process.env.COACH_EMAILS || "bh1525@nyu.edu")
  .toLowerCase()
  .split(",")
  .map((s) => s.trim());
const roleFor = (email) =>
  COACH_EMAILS.includes(email.toLowerCase()) ? "coach" : "student";

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
  const { email, name, password } = req.body;
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
    role: roleFor(email),
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
// The link carries a short-lived JWT. Sent via Brevo (BREVO_API_KEY +
// MAIL_FROM, a sender address verified in Brevo). Falls back to Resend
// (RESEND_API_KEY), then to printing the link in the server console (dev).
const MAGIC_SUBJECT = "Your Beta sign-in link";
const magicHtml = (link) =>
  `<p>Click to sign in to Beta:</p><p><a href="${link}">Sign in</a></p><p>This link expires in 15 minutes.</p>`;

async function sendMagicEmail(email, link) {
  if (process.env.BREVO_API_KEY) {
    // MAIL_FROM: "Name <email>" or a bare email
    const raw = process.env.MAIL_FROM || "";
    const m = raw.match(/^(.*)<(.+)>$/);
    const sender = m
      ? { name: m[1].trim() || "Beta", email: m[2].trim() }
      : { name: "Beta", email: raw.trim() };
    if (!sender.email) throw new Error("Set MAIL_FROM to your verified Brevo sender");
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender,
        to: [{ email }],
        subject: MAGIC_SUBJECT,
        htmlContent: magicHtml(link),
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.message || "Email send failed");
    }
    return { dev: false };
  }
  if (process.env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Beta <onboarding@resend.dev>",
        to: email,
        subject: MAGIC_SUBJECT,
        html: magicHtml(link),
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.message || "Email send failed");
    }
    return { dev: false };
  }
  console.log(`\n🔗 Magic sign-in link for ${email}:\n${link}\n`);
  return { dev: true };
}

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:5173";
}

app.post("/api/auth/magic-link", async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (!existing && !name)
    return res.status(404).json({ error: "new-user" }); // client then asks for name/role
  const token = jwt.sign(
    { magic: true, email: email.toLowerCase(), name },
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
        role: roleFor(payload.email),
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
// POST /api/videos with the blob URL. No auth: anonymous visitors can
// submit gallery sends, so uploads are open (size-capped).
app.post("/api/blob/upload", async (req, res) => {
  try {
    const jsonResponse = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname) => ({
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

// ---- Gallery routes (public: no sign-in needed to browse or submit sends) ----
app.get("/api/routes", async (req, res) => {
  const routes = await Route.find().sort({ createdAt: -1 });
  const counts = await Send.aggregate([
    { $match: { route: { $in: routes.map((r) => r._id) } } },
    { $group: { _id: "$route", n: { $sum: 1 } } },
  ]);
  const byId = Object.fromEntries(counts.map((c) => [c._id.toString(), c.n]));
  res.json(routes.map((r) => ({ ...r.toJSON(), sendCount: byId[r.id] || 0 })));
});

app.post("/api/routes", requireAuth, async (req, res) => {
  if (req.user.role !== "coach")
    return res.status(403).json({ error: "Only coaches can add routes" });
  const { title, grade, imageUrl, notes, match } = req.body;
  if (!title || !imageUrl)
    return res.status(400).json({ error: "Need a title and an image" });
  const route = await Route.create({
    owner: req.user.id,
    title,
    grade: grade || "?",
    match: !!match,
    imageUrl,
    notes: notes || "",
  });
  res.status(201).json(route);
});

app.get("/api/routes/:id", async (req, res) => {
  const route = await Route.findById(req.params.id).catch(() => null);
  if (!route) return res.status(404).json({ error: "Not found" });
  const sends = await Send.find({ route: route.id }).sort({ createdAt: 1 });
  res.json({ ...route.toJSON(), sends });
});

app.delete("/api/routes/:id", requireAuth, async (req, res) => {
  if (req.user.role !== "coach")
    return res.status(403).json({ error: "Only coaches can delete routes" });
  const route = await Route.findById(req.params.id).catch(() => null);
  if (!route) return res.status(404).json({ error: "Not found" });
  const sends = await Send.find({ route: route.id });
  await Send.deleteMany({ route: route.id });
  await route.deleteOne();
  for (const u of [route.imageUrl, ...sends.map((s) => s.videoUrl)])
    if (u?.startsWith("https://")) await del(u).catch(() => {});
  res.json({ ok: true });
});

// Submit a send: a typed name + video, not tied to an account.
// The first send claims the FA and flips the bounty.
app.post("/api/routes/:id/sends", async (req, res) => {
  const route = await Route.findById(req.params.id).catch(() => null);
  if (!route) return res.status(404).json({ error: "Not found" });
  const { videoUrl, author } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "A send video is required" });
  if (!author?.trim()) return res.status(400).json({ error: "Add your name" });
  const send = await Send.create({
    route: route.id,
    author: author.trim(),
    videoUrl,
  });
  let claimedFa = false;
  if (route.status === "bounty") {
    route.status = "fa";
    route.faBy = send.author;
    route.faAt = new Date();
    await route.save();
    claimedFa = true;
  }
  res.status(201).json({ send, route, claimedFa });
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
