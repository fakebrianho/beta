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

// Free-tier blob storage is 1GB total, so keep any single upload modest —
// a compressed 30s send clip lands around 5MB.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Simple shared passcode gating anonymous gallery sends (and their uploads)
const SEND_PASSCODE = process.env.SEND_PASSCODE || "sendit";
const passcodeOk = (p) =>
  typeof p === "string" &&
  p.trim().toLowerCase() === SEND_PASSCODE.toLowerCase();

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

// Session user if present, else null (for routes open to passcode holders)
async function userFromReq(req) {
  try {
    const { id } = jwt.verify(req.cookies[COOKIE], JWT_SECRET);
    return await User.findById(id);
  } catch {
    return null;
  }
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

// Let magic-link accounts (no password yet) add one so plain login works too
app.post("/api/auth/set-password", requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: "Password must be 6+ characters" });
  req.user.passwordHash = await bcrypt.hash(password, 10);
  await req.user.save();
  res.json(req.user);
});

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
// Cheap pre-check so the send form can reject a bad passcode with a clear
// message before spending time uploading the video
app.post("/api/check-passcode", async (req, res) => {
  if ((await userFromReq(req)) || passcodeOk(req.body.passcode))
    return res.json({ ok: true });
  res.status(401).json({ error: "Wrong passcode — ask at the gym" });
});

// POST /api/videos with the blob URL. Allowed for signed-in users, or for
// anonymous gallery senders who supply the shared passcode (clientPayload).
app.post("/api/blob/upload", async (req, res) => {
  try {
    const jsonResponse = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname, clientPayload) => {
        if (!(await userFromReq(req))) {
          let passcode;
          try {
            passcode = JSON.parse(clientPayload || "{}").passcode;
          } catch {}
          if (!passcodeOk(passcode)) throw new Error("Wrong passcode");
        }
        return {
          token: await issueSignedToken({
            pathname,
            operations: ["put"],
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            validUntil: Date.now() + 60 * 60 * 1000,
          }),
          urlOptions: {
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            addRandomSuffix: true,
            allowOverwrite: false,
          },
        };
      },
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
  const { title, notes, url, posterUrl } = req.body;
  if (!url) return res.status(400).json({ error: "No video URL" });
  const video = await Video.create({
    owner: req.user.id,
    title: title || "Untitled climb",
    student: req.user.name,
    notes: notes || "",
    url,
    posterUrl: posterUrl || null,
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
  for (const u of [req.video.url, req.video.posterUrl])
    if (u?.startsWith("https://")) await del(u).catch(() => {});
  res.json({ ok: true });
});

// ---- Gallery routes (public: no sign-in needed to browse or submit sends) ----

// Bounty = nobody has proven it goes yet. Setter beta clears the bounty
// without an FA; a non-setter send takes the FA.
function syncStatus(route) {
  route.status = route.faBy ? "fa" : route.betaVideoUrl ? "sent" : "bounty";
}

const ROUTE_TAGS = [
  "slopers", "crimps", "pinches", "dynamic", "static",
  "deadpoint", "dropknee", "sit start", "powerful",
];

// The setter owns the grade outright. Senders' opinions are recorded and
// shown, but only as advice for the setter to moderate with.
function displayGrade(route) {
  return route.gradeOverride || route.grade || "?";
}

// Advisory only: what the people who sent it thought
function suggestedGrade(sendGrades) {
  const gs = sendGrades.filter((g) => typeof g === "number");
  if (!gs.length) return null;
  const avg = gs.reduce((a, b) => a + b, 0) / gs.length;
  return { avg: Math.round(avg * 2) / 2, count: gs.length };
}

app.get("/api/routes", async (req, res) => {
  const routes = await Route.find().sort({ createdAt: -1 });
  const stats = await Send.aggregate([
    { $match: { route: { $in: routes.map((r) => r._id) } } },
    { $group: { _id: "$route", n: { $sum: 1 }, grades: { $push: "$grade" } } },
  ]);
  const byId = Object.fromEntries(stats.map((s) => [s._id.toString(), s]));
  const viewer = await userFromReq(req);
  const faves = new Set((viewer?.favorites || []).map((f) => f.toString()));
  res.json(
    routes.map((r) => ({
      ...r.toJSON(),
      sendCount: byId[r.id]?.n || 0,
      displayGrade: displayGrade(r),
      suggested: suggestedGrade(byId[r.id]?.grades || []),
      favorited: faves.has(r.id),
    }))
  );
});

// Heart a route (toggles)
app.post("/api/routes/:id/favorite", requireAuth, async (req, res) => {
  const route = await Route.findById(req.params.id).catch(() => null);
  if (!route) return res.status(404).json({ error: "Not found" });
  const i = req.user.favorites.findIndex((f) => f.equals(route._id));
  if (i >= 0) req.user.favorites.splice(i, 1);
  else req.user.favorites.push(route._id);
  await req.user.save();
  res.json({ favorited: i < 0 });
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
  const grades = sends.map((s) => s.grade);
  const gv = gradeValue(route);
  const viewer = await userFromReq(req);
  res.json({
    ...route.toJSON(),
    displayGrade: displayGrade(route),
    suggested: suggestedGrade(grades),
    favorited: !!viewer?.favorites.some((f) => f.equals(route._id)),
    sends: sends.map((s) => ({
      ...s.toJSON(),
      points: s.user
        ? scoreSend({ grade: gv, attempts: s.attempts, fa: s.fa })
        : 0,
    })),
  });
});

// Coach edits: set/clear the final grade (empty string clears the override)
app.patch("/api/routes/:id", requireAuth, async (req, res) => {
  if (req.user.role !== "coach")
    return res.status(403).json({ error: "Only coaches can edit routes" });
  const route = await Route.findById(req.params.id).catch(() => null);
  if (!route) return res.status(404).json({ error: "Not found" });
  if ("gradeOverride" in req.body)
    route.gradeOverride = req.body.gradeOverride?.trim() || null;
  if ("match" in req.body) route.match = !!req.body.match;
  if (Array.isArray(req.body.tags))
    route.tags = req.body.tags.filter((t) => ROUTE_TAGS.includes(t));
  if (req.body.imageUrl && req.body.imageUrl !== route.imageUrl) {
    if (route.imageUrl?.startsWith("https://"))
      await del(route.imageUrl).catch(() => {});
    route.imageUrl = req.body.imageUrl;
  }
  // Setter posting beta proves the route goes, so the bounty is off — but
  // nobody gets the FA for it.
  if ("betaVideoUrl" in req.body) {
    const next = req.body.betaVideoUrl?.trim() || null;
    const isSendVideo = await Send.exists({ videoUrl: route.betaVideoUrl });
    if (route.betaVideoUrl && route.betaVideoUrl !== next && !isSendVideo) {
      await del(route.betaVideoUrl).catch(() => {});
      if (route.betaPosterUrl) await del(route.betaPosterUrl).catch(() => {});
    }
    route.betaVideoUrl = next;
    route.betaPosterUrl = req.body.betaPosterUrl?.trim() || null;
    route.betaBy = next ? req.user.name : null;
    syncStatus(route);
  }
  if (req.body.title) route.title = req.body.title;
  await route.save();
  const sends = await Send.find({ route: route.id });
  res.json({
    ...route.toJSON(),
    displayGrade: displayGrade(route),
    suggested: suggestedGrade(sends.map((s) => s.grade)),
  });
});

app.delete("/api/routes/:id", requireAuth, async (req, res) => {
  if (req.user.role !== "coach")
    return res.status(403).json({ error: "Only coaches can delete routes" });
  const route = await Route.findById(req.params.id).catch(() => null);
  if (!route) return res.status(404).json({ error: "Not found" });
  const sends = await Send.find({ route: route.id });
  await Send.deleteMany({ route: route.id });
  await route.deleteOne();
  for (const u of [
    route.imageUrl,
    route.betaVideoUrl,
    route.betaPosterUrl,
    ...sends.map((s) => s.videoUrl),
    ...sends.map((s) => s.posterUrl),
  ])
    if (u?.startsWith("https://")) await del(u).catch(() => {});
  res.json({ ok: true });
});

// Leaderboard scoring, off the route's effective grade:
//   base      = grade × 1000 (V0 floors at 1000)
//   flash     = base + 1000 bonus, with no attempt penalty (no bonus at V0)
//   otherwise = base − 100 × attempts
//   FA        = +1000 on top
// Scores are computed live so regrades flow through to the board.
function scoreSend({ grade, attempts, fa }) {
  if (!Number.isFinite(attempts) || attempts < 1) return 0; // pre-attempts send
  const g = Number.isFinite(grade) ? grade : 0;
  const base = Math.max(g, 1) * 1000;
  let pts =
    attempts <= 1 ? base + (g === 0 ? 0 : 1000) : base - 100 * attempts;
  if (fa) pts += 1000;
  return Math.max(0, Math.round(pts));
}

// Numeric form of a route's grade ("V4/5" → 4), used for scoring
function gradeValue(route) {
  const m = String(displayGrade(route)).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

// Points only accrue to signed-up accounts (anonymous sends score 0).
// Coaches never appear on the board.
async function leaderboardRows() {
  const [users, routes, sends] = await Promise.all([
    User.find({ role: { $ne: "coach" } }),
    Route.find(),
    Send.find({ user: { $ne: null } }),
  ]);

  const gradeByRoute = {};
  for (const r of routes) gradeByRoute[r.id] = gradeValue(r);

  const byUser = new Map(
    users.map((u) => [
      u.id,
      {
        id: u.id,
        name: u.name,
        avatarUrl: u.avatarUrl,
        earned: 0,
        adjustment: u.pointsAdjustment || 0,
        sends: 0,
        fas: 0,
      },
    ])
  );
  for (const s of sends) {
    const row = byUser.get(s.user.toString());
    if (!row) continue; // coach, or a deleted account
    row.earned += scoreSend({
      grade: gradeByRoute[s.route.toString()],
      attempts: s.attempts,
      fa: s.fa,
    });
    row.sends++;
    if (s.fa) row.fas++;
  }

  return [...byUser.values()]
    .map((r) => ({ ...r, points: r.earned + r.adjustment }))
    .filter((r) => r.sends > 0 || r.adjustment !== 0)
    .sort((a, b) => b.points - a.points || a.sends - b.sends)
    .map((r, i) => ({ rank: i + 1, ...r }));
}

app.get("/api/leaderboard", async (req, res) => {
  res.json(await leaderboardRows());
});

// ---- Profiles: a climber's sends, plus their favorites when it's their own ----
async function buildProfile(user, isSelf) {
  const sends = await Send.find({ user: user.id }).sort({ createdAt: -1 });
  const wanted = [
    ...new Set([
      ...sends.map((s) => s.route.toString()),
      ...(isSelf ? user.favorites.map((f) => f.toString()) : []),
    ]),
  ];
  const routes = await Route.find({ _id: { $in: wanted } });

  const summary = (r) => ({
    id: r.id,
    title: r.title,
    imageUrl: r.imageUrl,
    status: r.status,
    match: r.match,
    tags: r.tags,
    displayGrade: displayGrade(r),
  });
  const routeById = Object.fromEntries(routes.map((r) => [r.id, r]));
  const gradeOf = (id) => (routeById[id] ? gradeValue(routeById[id]) : 0);

  const row = (await leaderboardRows()).find((r) => r.id === user.id);
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    joined: user.createdAt,
    points: row?.points || 0,
    rank: row?.rank || null,
    bounties: sends.filter((s) => s.bounty).length, // beat the setter to it
    fas: sends.filter((s) => s.fa).length,
    isSelf,
    sends: sends
      .filter((s) => routeById[s.route.toString()])
      .map((s) => ({
        id: s.id,
        attempts: s.attempts,
        grade: s.grade,
        fa: s.fa,
        videoUrl: s.videoUrl,
        createdAt: s.createdAt,
        points: scoreSend({
          grade: gradeOf(s.route.toString()),
          attempts: s.attempts,
          fa: s.fa,
        }),
        route: summary(routeById[s.route.toString()]),
      })),
    favorites: isSelf
      ? user.favorites
          .map((f) => routeById[f.toString()])
          .filter(Boolean)
          .map(summary)
      : [],
  };
}

app.get("/api/profile", requireAuth, async (req, res) =>
  res.json(await buildProfile(req.user, true))
);

// Profile picture (client uploads to Blob first, then hands us the URL)
app.patch("/api/profile", requireAuth, async (req, res) => {
  const { avatarUrl, name } = req.body;
  if ("avatarUrl" in req.body) {
    const next = avatarUrl?.trim() || null;
    if (next && !next.includes(".blob.vercel-storage.com/"))
      return res.status(400).json({ error: "Bad image URL" });
    if (req.user.avatarUrl && req.user.avatarUrl !== next)
      await del(req.user.avatarUrl).catch(() => {});
    req.user.avatarUrl = next;
  }
  if (name?.trim()) req.user.name = name.trim();
  await req.user.save();
  res.json(req.user);
});

app.get("/api/profile/:id", async (req, res) => {
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) return res.status(404).json({ error: "No such climber" });
  const viewer = await userFromReq(req);
  res.json(await buildProfile(user, viewer?.id === user.id));
});

// Coach can nudge anyone's total; we store the delta so new sends still count
app.patch("/api/users/:id/points", requireAuth, async (req, res) => {
  if (req.user.role !== "coach")
    return res.status(403).json({ error: "Only coaches can edit scores" });
  const user = await User.findById(req.params.id).catch(() => null);
  if (!user) return res.status(404).json({ error: "No such user" });
  const target = Number(req.body.points);
  if (!Number.isFinite(target))
    return res.status(400).json({ error: "Points must be a number" });
  const row = (await leaderboardRows()).find((r) => r.id === user.id);
  user.pointsAdjustment = Math.round(target - (row?.earned || 0));
  await user.save();
  res.json(await leaderboardRows());
});

// Submit a send: a typed name + video, not tied to an account.
// The first send claims the FA and flips the bounty.
app.post("/api/routes/:id/sends", async (req, res) => {
  const route = await Route.findById(req.params.id).catch(() => null);
  if (!route) return res.status(404).json({ error: "Not found" });
  const { videoUrl, posterUrl, author, passcode, grade, attempts } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "A send video is required" });
  const user = await userFromReq(req);
  const name = user?.name || author?.trim(); // signed-in sends use the account name
  if (!name) return res.status(400).json({ error: "Add your name" });
  if (!user && !passcodeOk(passcode))
    return res.status(401).json({ error: "Wrong passcode — ask at the gym" });
  const tries = Math.floor(Number(attempts));
  if (!Number.isFinite(tries) || tries < 1)
    return res.status(400).json({ error: "How many attempts did it take?" });
  const g = Number(grade);
  // First ascent means first: only the very first send on a route can claim
  // it, and only if that sender isn't the setter. Checking route.faBy alone
  // wasn't enough — on a route the setter had sent, faBy stayed null and a
  // late sender could grab an FA ahead of people who sent it weeks earlier.
  const isSetter = user?.role === "coach";
  const priorSends = await Send.countDocuments({ route: route.id });
  const claimedFa = !isSetter && priorSends === 0 && !route.faBy;
  // Posting beta doesn't block the FA, but it does mean no bounty was claimed
  const claimedBounty = claimedFa && !route.betaVideoUrl;
  const sendGrade = Number.isFinite(g) && g >= 0 && g <= 17 ? g : null;
  const send = await Send.create({
    route: route.id,
    user: user?.id || null,
    author: name,
    grade: sendGrade,
    attempts: tries,
    fa: claimedFa,
    bounty: claimedBounty,
    points: user
      ? scoreSend({
          grade: gradeValue(route),
          attempts: tries,
          fa: claimedFa,
        })
      : 0,
    videoUrl,
    posterUrl: posterUrl || null,
  });
  let changed = false;
  if (claimedFa) {
    route.faBy = send.author;
    route.faAt = new Date();
    changed = true;
  }
  // The route's beta is whichever video landed first — a setter upload always
  // wins, otherwise the FA's send fills the slot.
  if (!route.betaVideoUrl) {
    route.betaVideoUrl = send.videoUrl;
    route.betaPosterUrl = send.posterUrl;
    route.betaBy = send.author;
    changed = true;
  }
  if (changed) {
    syncStatus(route);
    await route.save();
  }
  res.status(201).json({ send, route, claimedFa, claimedBounty });
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
