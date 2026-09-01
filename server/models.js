import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, default: null }, // null for passwordless (magic-link) accounts
    role: { type: String, enum: ["student", "coach"], default: "student" },
  },
  { timestamps: true }
);

const videoSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    student: String, // owner's display name, denormalized for listing
    notes: { type: String, default: "" },
    url: { type: String, required: true }, // Vercel Blob URL (or /uploads/... for legacy local files)
    status: { type: String, enum: ["submitted", "reviewed"], default: "submitted" },
  },
  { timestamps: true }
);

const commentSchema = new mongoose.Schema(
  {
    video: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    author: String,
    time: { type: Number, required: true },
    text: { type: String, default: "" },
    drawing: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Gallery routes: a problem someone set/found, open as a "bounty" until the
// first ascent video flips it to "fa"
const routeSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    grade: { type: String, default: "?" }, // proposed/suggested grade
    match: { type: Boolean, default: true }, // matching holds allowed?
    imageUrl: { type: String, required: true }, // vertical hero image (Blob URL)
    notes: { type: String, default: "" },
    status: { type: String, enum: ["bounty", "fa"], default: "bounty" },
    faBy: { type: String, default: null }, // name of first ascensionist
    faAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// A send: proof video of someone doing a gallery route
const sendSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: "Route", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // sends aren't tied to accounts
    author: { type: String, required: true },
    grade: { type: Number, min: 0, max: 17, default: null }, // sender's V-grade opinion
    videoUrl: { type: String, required: true },
  },
  { timestamps: true }
);

// Serve the same shape the client already expects (id, url, createdAt)
const clean = (schema) =>
  schema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      if ("passwordHash" in ret) ret.hasPassword = !!ret.passwordHash;
      delete ret.passwordHash;
      if (ret.video) ret.videoId = ret.video.toString();
      return ret;
    },
  });

clean(userSchema);
clean(videoSchema);
clean(commentSchema);
clean(routeSchema);
clean(sendSchema);

export const User = mongoose.model("User", userSchema);
export const Video = mongoose.model("Video", videoSchema);
export const Comment = mongoose.model("Comment", commentSchema);
export const Route = mongoose.model("Route", routeSchema);
export const Send = mongoose.model("Send", sendSchema);
