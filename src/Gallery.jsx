import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { toDisplayableImage } from "./image.js";
import { TAGS, TAG_COLORS } from "./tags.js";

// "V6", "v5/6", "6" → 6; unparseable grades return null
const gradeNum = (r) => {
  const m = (r.displayGrade || r.grade || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

function TagDots({ tags, onTag }) {
  if (!tags?.length) return null;
  return (
    <span className="tag-dots">
      {tags.map((t) => (
        <span
          key={t}
          className="tag-dot"
          style={{ background: TAG_COLORS[t] }}
          title={`${t} — click to filter`}
          onClick={(e) => {
            e.stopPropagation();
            onTag?.(t);
          }}
        />
      ))}
    </span>
  );
}

export default function Gallery({
  user,
  initialRouteId,
  onConsumedInitialRoute,
}) {
  const role = user?.role || null;
  const [routes, setRoutes] = useState([]);
  const [openRoute, setOpenRoute] = useState(null); // full route with sends
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [gradeRange, setGradeRange] = useState([0, 17]);
  const [tagFilter, setTagFilter] = useState([]);

  const [lo, hi] = gradeRange;
  const setLo = (v) => setGradeRange([Math.min(v, hi), hi]);
  const setHi = (v) => setGradeRange([lo, Math.max(v, lo)]);
  const toggleTagFilter = (t) =>
    setTagFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]));
  const filtered = routes.filter((r) => {
    const g = gradeNum(r);
    if (g !== null && (g < lo || g > hi)) return false; // ungraded routes always show
    return tagFilter.every((t) => r.tags?.includes(t));
  });
  const hasFilter = lo > 0 || hi < 17 || tagFilter.length > 0;

  const refresh = () =>
    api.listRoutes().then(setRoutes).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  // Arriving from a profile tile: pop that route straight open
  useEffect(() => {
    if (!initialRouteId) return;
    api.getRoute(initialRouteId).then(setOpenRoute).catch(() => {});
    onConsumedInitialRoute?.();
  }, [initialRouteId]);

  async function open(id) {
    setOpenRoute(await api.getRoute(id));
  }

  async function toggleFavorite(id) {
    const { favorited } = await api.toggleFavorite(id);
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, favorited } : r)));
    setOpenRoute((o) => (o?.id === id ? { ...o, favorited } : o));
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
      <div className="grade-filter">
        <span className="muted">
          Grade: V{lo} – V{hi}
        </span>
        <div className="grade-sliders">
          <input
            type="range"
            min={0}
            max={17}
            value={lo}
            onChange={(e) => setLo(Number(e.target.value))}
          />
          <input
            type="range"
            min={0}
            max={17}
            value={hi}
            onChange={(e) => setHi(Number(e.target.value))}
          />
        </div>
        {hasFilter && (
          <button
            className="link-btn"
            onClick={() => {
              setGradeRange([0, 17]);
              setTagFilter([]);
            }}
          >
            reset
          </button>
        )}
      </div>
      <div className="tag-chips tag-filter">
        {TAGS.map((t) => {
          const on = tagFilter.includes(t);
          return (
            <button
              key={t}
              className={`tag-chip ${on ? "on" : ""}`}
              style={
                on
                  ? { borderColor: TAG_COLORS[t], color: TAG_COLORS[t] }
                  : undefined
              }
              onClick={() => toggleTagFilter(t)}
            >
              {t}
            </button>
          );
        })}
      </div>

      {error && <p className="error">{error}</p>}
      {routes.length === 0 && (
        <p className="muted">No routes yet. Coaches can add one.</p>
      )}
      {routes.length > 0 && filtered.length === 0 && (
        <p className="muted">No routes match the current filters.</p>
      )}

      <div className="route-grid">
        {filtered.map((r) => (
          <div key={r.id} className="route-card" onClick={() => open(r.id)}>
            <img src={r.imageUrl} alt={r.title} loading="lazy" />
            {user && (
              <button
                className={`fav-btn ${r.favorited ? "on" : ""}`}
                title={r.favorited ? "Remove from favorites" : "Add to favorites"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(r.id);
                }}
              >
                {r.favorited ? "♥" : "♡"}
              </button>
            )}
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
                <TagDots tags={r.tags} onTag={toggleTagFilter} />
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
          onToggleFavorite={() => toggleFavorite(openRoute.id)}
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

function RouteDetail({ route, user, onToggleFavorite, onClose, onChanged }) {
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
            <h3 className="route-title-row">
              <span>
                {route.title} · {route.match ? "match" : "no match"}
              </span>
              {user && (
                <button
                  className={`fav-btn inline ${route.favorited ? "on" : ""}`}
                  title={
                    route.favorited ? "Remove from favorites" : "Add to favorites"
                  }
                  onClick={onToggleFavorite}
                >
                  {route.favorited ? "♥" : "♡"}
                </button>
              )}
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
            {route.tags?.length > 0 && (
              <div className="tag-chips">
                {route.tags.map((t) => (
                  <span
                    key={t}
                    className="tag-chip"
                    style={{ borderColor: TAG_COLORS[t], color: TAG_COLORS[t] }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
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
