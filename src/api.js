async function json(res) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

const post = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json);

export const api = {
  me: () => fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
  signup: (data) => post("/api/auth/signup", data),
  login: (data) => post("/api/auth/login", data),
  logout: () => post("/api/auth/logout", {}),
  magicLink: (data) => post("/api/auth/magic-link", data),
  listVideos: () => fetch("/api/videos").then(json),
  getVideo: (id) => fetch(`/api/videos/${id}`).then(json),
  // Upload goes browser → Vercel Blob (token minted by /api/blob/upload),
  // then the video is registered with its blob URL.
  uploadVideo: async ({ file, title, notes }, onProgress) => {
    const { uploadPresigned } = await import("@vercel/blob/client");
    const blob = await uploadPresigned(file.name, file, {
      access: "public",
      handleUploadUrl: "/api/blob/upload",
      onUploadProgress: ({ percentage }) => onProgress?.(percentage / 100),
    });
    return post("/api/videos", { title, notes, url: blob.url });
  },
  deleteVideo: (id) => fetch(`/api/videos/${id}`, { method: "DELETE" }).then(json),
  setStatus: (id, status) =>
    fetch(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(json),
  listComments: (videoId) => fetch(`/api/videos/${videoId}/comments`).then(json),
  addComment: (videoId, comment) =>
    fetch(`/api/videos/${videoId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comment),
    }).then(json),
  deleteComment: (id) => fetch(`/api/comments/${id}`, { method: "DELETE" }).then(json),
};

export function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}
