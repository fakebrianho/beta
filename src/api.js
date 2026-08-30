async function json(res) {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

export const api = {
  listVideos: () => fetch("/api/videos").then(json),
  getVideo: (id) => fetch(`/api/videos/${id}`).then(json),
  uploadVideo: (formData, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/videos");
      xhr.upload.onprogress = (e) =>
        e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () =>
        xhr.status < 300
          ? resolve(JSON.parse(xhr.responseText))
          : reject(new Error("Upload failed"));
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(formData);
    }),
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
