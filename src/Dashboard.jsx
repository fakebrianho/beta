import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

export default function Dashboard({ role, onOpen }) {
  const [videos, setVideos] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const formRef = useRef(null);

  const refresh = () => api.listVideos().then(setVideos).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  async function handleUpload(e) {
    e.preventDefault();
    setError("");
    const fd = new FormData(formRef.current);
    const file = fd.get("video");
    if (!file?.name) return setError("Pick a video file first.");
    try {
      setProgress(0);
      await api.uploadVideo(
        { file, title: fd.get("title"), notes: fd.get("notes") },
        setProgress
      );
      formRef.current.reset();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this video and its comments?")) return;
    await api.deleteVideo(id);
    refresh();
  }

  return (
    <main className="dashboard">
      {role === "student" && (
        <section className="upload-card">
          <h2>Submit a climb</h2>
          <form ref={formRef} onSubmit={handleUpload}>
            <input name="title" placeholder="Title (e.g. V5 crimpy overhang attempt)" />
            <textarea
              name="notes"
              rows={2}
              placeholder="What do you want feedback on?"
            />
            <input name="video" type="file" accept="video/*" />
            <button type="submit" disabled={progress !== null}>
              {progress !== null
                ? `Uploading… ${Math.round(progress * 100)}%`
                : "Upload"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      <section>
        <h2>{role === "coach" ? "Submissions to review" : "Your submissions"}</h2>
        {videos.length === 0 && <p className="muted">No videos yet.</p>}
        <div className="video-grid">
          {videos.map((v) => (
            <div key={v.id} className="video-card" onClick={() => onOpen(v.id)}>
              <video src={v.url} preload="metadata" muted />
              <div className="video-card-body">
                <strong>{v.title}</strong>
                <span className="muted">
                  {v.student} · {new Date(v.createdAt).toLocaleDateString()}
                </span>
                <div className="badges">
                  <span className={`badge ${v.status}`}>{v.status}</span>
                  <span className="badge">{v.commentCount} comments</span>
                </div>
              </div>
              {role === "coach" && (
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(v.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
