import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

export default function Dashboard({ role, onOpen }) {
  const [videos, setVideos] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const formRef = useRef(null);

  const refresh = () => api.listVideos().then(setVideos).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
    if (role === "coach") api.listRoutes().then(setRoutes).catch(() => {});
  }, [role]);

  async function setGrade(r) {
    const g = prompt(
      `Final grade for "${r.title}" (e.g. V7).\nThis overrides the community average. Leave empty to go back to averaging.`,
      r.gradeOverride || ""
    );
    if (g === null) return;
    const updated = await api.updateRoute(r.id, { gradeOverride: g });
    setRoutes(routes.map((x) => (x.id === r.id ? { ...x, ...updated } : x)));
  }

  async function deleteRoute(id) {
    if (!confirm("Delete this route and its send videos?")) return;
    await api.deleteRoute(id);
    setRoutes(routes.filter((r) => r.id !== id));
  }

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

      {role === "coach" && routes.length > 0 && (
        <section className="route-admin">
          <h2>Gallery routes</h2>
          <div className="route-admin-list">
            {routes.map((r) => (
              <div key={r.id} className="route-admin-row">
                <img src={r.imageUrl} alt="" />
                <div className="route-admin-info">
                  <strong>{r.title}</strong>
                  <span className="muted">
                    {r.displayGrade || r.grade}
                    {r.gradeOverride && " (set by you)"} ·{" "}
                    {r.status === "bounty" ? "💰 bounty" : `✓ FA by ${r.faBy}`} ·{" "}
                    {r.sendCount} send{r.sendCount === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  title="Set final grade"
                  onClick={() => setGrade(r)}
                >
                  ✎ grade
                </button>
                <button className="delete-btn" onClick={() => deleteRoute(r.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
