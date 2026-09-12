import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { toDisplayableImage } from "./image.js";

export default function Gallery({ user }) {
  const role = user?.role || null;
  const [routes, setRoutes] = useState([]);
  const [openRoute, setOpenRoute] = useState(null); // full route with sends
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    api.listRoutes().then(setRoutes).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  async function open(id) {
    setOpenRoute(await api.getRoute(id));
  }

  return (
    <main className="dashboard">
      <div className="gallery-head">
        <h2>Route gallery</h2>
        {role === "coach" && (
          <button className="add-route-btn" onClick={() => setAdding(true)}>
            + Add route
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {routes.length === 0 && (
        <p className="muted">No routes yet. Coaches can add one.</p>
      )}

      <div className="route-grid">
        {routes.map((r) => (
          <div key={r.id} className="route-card" onClick={() => open(r.id)}>
            <img src={r.imageUrl} alt={r.title} loading="lazy" />
            <div className="route-card-overlay">
              <strong>
                {r.title} · {r.match ? "match" : "no match"}
              </strong>
              <div className="badges">
                <span className="badge grade">{r.displayGrade || r.grade}</span>
                {r.status === "bounty" ? (
                  <span className="badge bounty">💰 Bounty</span>
                ) : (
                  <span className="badge fa">✓ FA · {r.faBy}</span>
                )}
                {r.sendCount > 0 && (
                  <span className="badge">{r.sendCount} send{r.sendCount > 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <AddRouteModal
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {openRoute && (
        <RouteDetail
          route={openRoute}
          user={user}
          onClose={() => setOpenRoute(null)}
          onChanged={async () => {
            await open(openRoute.id);
            refresh();
          }}
        />
      )}
    </main>
  );
}

function AddRouteModal({ onClose, onAdded }) {
  const formRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    const fd = new FormData(formRef.current);
    const image = fd.get("image");
    if (!image?.name) return setError("Pick a hero image first.");
    try {
      setProgress(0);
      const imageUrl = await api.uploadFile(
        await toDisplayableImage(image),
        setProgress
      );
      await api.addRoute({
        title: fd.get("title"),
        grade: fd.get("grade"),
        match: fd.get("match") === "on",
        notes: fd.get("notes"),
        imageUrl,
      });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a route</h3>
        <form ref={formRef} onSubmit={submit}>
          <input name="title" placeholder="Route name" required />
          <input name="grade" placeholder="Proposed grade (e.g. V6)" />
          <label className="check-label">
            <input name="match" type="checkbox" defaultChecked />
            Matching allowed
          </label>
          <textarea name="notes" rows={2} placeholder="Beta / description (optional)" />
          <label className="muted">
            Hero image (vertical works best)
            <input name="image" type="file" accept="image/*" required />
          </label>
          <button type="submit" disabled={progress !== null}>
            {progress !== null
              ? `Uploading… ${Math.round(progress * 100)}%`
              : "Add to gallery"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function RouteDetail({ route, user, onClose, onChanged }) {
  const signedIn = user != null;
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const formRef = useRef(null);

  async function submitSend(e) {
    e.preventDefault();
    const fd = new FormData(formRef.current);
    const file = fd.get("video");
    const author = user?.name || (fd.get("author") || "").trim();
    const passcode = (fd.get("passcode") || "").trim();
    const grade = fd.get("grade");
    const attempts = fd.get("attempts");
    if (!file?.name) return setError("A send video is required.");
    if (!author) return setError("Add your name.");
    if (!attempts || Number(attempts) < 1)
      return setError("How many attempts did it take?");
    setError("");
    try {
      await api.checkPasscode(passcode); // fail fast before the big upload
      setProgress(0);
      const videoUrl = await api.uploadFile(file, setProgress, passcode);
      const { claimedFa } = await api.addSend(route.id, {
        videoUrl,
        author,
        passcode,
        grade: grade === "" ? null : Number(grade),
        attempts: Number(attempts),
      });
      if (claimedFa) alert("🎉 First ascent! The bounty is yours.");
      formRef.current.reset();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal route-detail" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="route-detail-layout">
          <img className="route-hero" src={route.imageUrl} alt={route.title} />
          <div className="route-info">
            <h3>
              {route.title} · {route.match ? "match" : "no match"}
            </h3>
            <div className="badges">
              <span className="badge grade" title={`Proposed: ${route.grade}`}>
                {route.displayGrade || route.grade}
              </span>
              {route.status === "bounty" ? (
                <span className="badge bounty">💰 Bounty — unclaimed</span>
              ) : (
                <span className="badge fa">
                  ✓ FA by {route.faBy}
                  {route.faAt && ` · ${new Date(route.faAt).toLocaleDateString()}`}
                </span>
              )}
            </div>
            {route.notes && <p className="muted">{route.notes}</p>}

            <h4>Sends ({route.sends.length})</h4>
            {route.sends.length === 0 && (
              <p className="muted">
                No one has done this yet — send it and claim the FA.
              </p>
            )}
            <div className="send-list">
              {route.sends.map((s) => (
                <div key={s.id} className="send">
                  <video src={s.videoUrl} controls preload="metadata" />
                  <span className="muted">
                    {s.author}
                    {s.attempts != null &&
                      ` · ${s.attempts === 1 ? "⚡ flash" : `${s.attempts} attempts`}`}
                    {s.grade != null && ` · called it V${s.grade}`}
                    {s.points > 0 && ` · ${s.points} pts`} ·{" "}
                    {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>

            <form className="send-form" ref={formRef} onSubmit={submitSend}>
              <input
                name="author"
                placeholder="Your name"
                required
                defaultValue={user?.name || ""}
                readOnly={signedIn}
                className={signedIn ? "locked" : ""}
                title={signedIn ? "Posting as your account" : undefined}
              />
              <input
                name="attempts"
                type="number"
                min={1}
                step={1}
                placeholder="Attempts it took (1 = flash)"
                required
              />
              <select name="grade" defaultValue="">
                <option value="">Your grade opinion (optional)</option>
                {Array.from({ length: 18 }, (_, i) => (
                  <option key={i} value={i}>
                    V{i}
                  </option>
                ))}
              </select>
              {!signedIn && (
                <input
                  name="passcode"
                  placeholder="Gym passcode"
                  autoComplete="off"
                  required
                />
              )}
              <label className="muted">
                Did it? Upload your send video (required):
                <input name="video" type="file" accept="video/*" required />
              </label>
              <button type="submit" disabled={progress !== null}>
                {progress !== null
                  ? `Uploading… ${Math.round(progress * 100)}%`
                  : route.status === "bounty"
                    ? "Submit send & claim FA"
                    : "Submit send"}
              </button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
