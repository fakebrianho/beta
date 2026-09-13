import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { toDisplayableImage } from "./image.js";
import { TAGS, TAG_COLORS } from "./tags.js";
import { compressVideo, posterFrom, MAX_UPLOAD_MB, tooBig } from "./video.js";

export default function Dashboard({ role, onOpen }) {
  const [videos, setVideos] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [tagEditor, setTagEditor] = useState(null); // route id with tag editor open
  const [progress, setProgress] = useState(null);
  const [stage, setStage] = useState("");
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

  const patchRoute = async (id, data) => {
    const updated = await api.updateRoute(id, data);
    setRoutes((rs) => rs.map((x) => (x.id === id ? { ...x, ...updated } : x)));
  };

  async function toggleTag(r, tag) {
    const tags = r.tags?.includes(tag)
      ? r.tags.filter((t) => t !== tag)
      : [...(r.tags || []), tag];
    await patchRoute(r.id, { tags }).catch((e) => setError(e.message));
  }

  async function toggleMatch(r) {
    await patchRoute(r.id, { match: !r.match }).catch((e) => setError(e.message));
  }

  async function changePhoto(r, file) {
    if (!file) return;
    setError("");
    try {
      const imageUrl = await api.uploadFile(await toDisplayableImage(file));
      await patchRoute(r.id, { imageUrl });
    } catch (e) {
      setError(e.message);
    }
  }

  // Posting beta proves the route goes, so the bounty comes off it
  async function uploadBeta(r, file) {
    if (!file) return;
    setError("");
    setStage(`Compressing beta for ${r.title}…`);
    setProgress(0);
    try {
      const [clip, poster] = await Promise.all([
        compressVideo(file, setProgress),
        posterFrom(file),
      ]);
      if (clip.size > MAX_UPLOAD_MB * 1024 * 1024)
        throw tooBig(clip, clip === file);
      setStage("Uploading beta…");
      setProgress(0);
      const betaVideoUrl = await api.uploadFile(clip, setProgress);
      const betaPosterUrl = poster
        ? await api.uploadFile(poster).catch(() => null)
        : null;
      await patchRoute(r.id, { betaVideoUrl, betaPosterUrl });
    } catch (e) {
      setError(e.message);
    } finally {
      setProgress(null);
      setStage("");
    }
  }

  async function clearBeta(r) {
    if (!confirm(`Remove your beta for "${r.title}" and put the bounty back?`))
      return;
    await patchRoute(r.id, { betaVideoUrl: null, betaPosterUrl: null }).catch(
      (e) => setError(e.message)
    );
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
      setStage("Compressing video…");
      setProgress(0);
      const [clip, poster] = await Promise.all([
        compressVideo(file, setProgress),
        posterFrom(file),
      ]);
      if (clip.size > MAX_UPLOAD_MB * 1024 * 1024)
        throw tooBig(clip, clip === file);
      setStage("Uploading…");
      setProgress(0);
      const posterUrl = poster
        ? await api.uploadFile(poster).catch(() => null)
        : null;
      await api.uploadVideo(
        {
          file: clip,
          posterUrl,
          title: fd.get("title"),
          notes: fd.get("notes"),
        },
        setProgress
      );
      formRef.current.reset();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
      setStage("");
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
                ? `${stage} ${Math.round(progress * 100)}%`
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
              <video src={v.url} preload="none" poster={v.posterUrl} muted />
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
          {progress !== null && (
            <p className="muted">
              {stage} {Math.round(progress * 100)}%
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="route-admin-list">
            {routes.map((r) => (
              <React.Fragment key={r.id}>
              <div className="route-admin-row">
                <img src={r.imageUrl} alt="" />
                <div className="route-admin-info">
                  <strong>{r.title}</strong>
                  <span className="muted">
                    {r.displayGrade || r.grade}
                    {r.gradeOverride && " (set by you)"} ·{" "}
                    {r.match ? "match" : "no match"} ·{" "}
                    {r.status === "bounty"
                      ? "💰 bounty"
                      : r.status === "fa"
                        ? `✓ FA by ${r.faBy}`
                        : "🎬 your beta"}{" "}
                    · {r.sendCount} send{r.sendCount === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  title="Set final grade"
                  onClick={() => setGrade(r)}
                >
                  ✎ grade
                </button>
                <button
                  title="Edit style tags"
                  onClick={() => setTagEditor(tagEditor === r.id ? null : r.id)}
                >
                  🏷 {r.tags?.length || 0}
                </button>
                <button
                  title="Toggle matching allowed"
                  onClick={() => toggleMatch(r)}
                >
                  {r.match ? "🚫 no match" : "🤝 match"}
                </button>
                <label className="photo-btn" title="Replace the hero photo">
                  📷
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      changePhoto(r, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label
                  className="photo-btn"
                  title={
                    r.betaVideoUrl
                      ? "Replace the beta video"
                      : "Upload your beta — clears the bounty"
                  }
                >
                  🎬{r.betaVideoUrl ? "✓" : ""}
                  <input
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(e) => {
                      uploadBeta(r, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {r.status === "sent" && (
                  <button
                    title="Remove your beta and restore the bounty"
                    onClick={() => clearBeta(r)}
                  >
                    ↩︎
                  </button>
                )}
                <button className="delete-btn" onClick={() => deleteRoute(r.id)}>
                  ✕
                </button>
              </div>
              {tagEditor === r.id && (
                <div className="tag-editor">
                  {TAGS.map((t) => {
                    const on = r.tags?.includes(t);
                    return (
                      <button
                        key={t}
                        className={`tag-chip ${on ? "on" : ""}`}
                        style={
                          on
                            ? { borderColor: TAG_COLORS[t], color: TAG_COLORS[t] }
                            : undefined
                        }
                        onClick={() => toggleTag(r, t)}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              )}
              </React.Fragment>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
