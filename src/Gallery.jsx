import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import LazyVideo from "./LazyVideo.jsx";
import useScrollLock from "./useScrollLock.js";
import { compressVideo, posterFrom, MAX_UPLOAD_MB, tooBig } from "./video.js";
import { TAGS, TAG_COLORS } from "./tags.js";
import WallView, {
  ROLES,
  ROLE_COLORS,
  RoleLegend,
  RouteImage,
  holdMap,
  holdProblem,
  useWall,
} from "./WallView.jsx";

// "V6", "v5/6", "6" → 6; unparseable grades return null
const gradeNum = (r) => {
  const m = (r.displayGrade || r.grade || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

// Share of 👍 among a route's votes, or null when nobody has rated it
const ratingPct = (r) => {
  const { up = 0, down = 0 } = r.rating || {};
  return up + down ? Math.round((100 * up) / (up + down)) : null;
};
// Sorting runs after the grade/tag filters. The API already returns newest
// first, and Array.sort is stable, so ties keep that order.
const ups = (r) => r.rating?.up || 0;
const downs = (r) => r.rating?.down || 0;
const SORTS = [
  { key: "new", label: "Newest", cmp: null },
  { key: "ups", label: "Most 👍", cmp: (a, b) => ups(b) - ups(a) || downs(a) - downs(b) },
  {
    key: "pct",
    label: "Best rated",
    // Unrated routes go last; equal percentages favor more votes
    cmp: (a, b) =>
      (ratingPct(b) ?? -1) - (ratingPct(a) ?? -1) || ups(b) + downs(b) - (ups(a) + downs(a)),
  },
];

// Raw 👍 / 👎 counts so you can eyeball whether people liked it
export function RatingBadge({ route }) {
  const pct = ratingPct(route);
  if (pct === null) return null;
  const { up, down } = route.rating;
  return (
    <span
      className="badge rating-badge"
      title={`${pct}% liked it, from people who sent it`}
    >
      <span>👍 {up}</span>
      <span>👎 {down}</span>
    </span>
  );
}

// bounty = unproven, sent = setter posted beta (no FA), fa = someone beat the setter
export function StatusBadge({ route, long }) {
  if (route.status === "bounty")
    return (
      <span className="badge bounty">
        💰 Bounty{long ? " — nobody's done it" : ""}
      </span>
    );
  if (route.status === "fa")
    return (
      <span className="badge fa">
        ✓ FA · {route.faBy}
        {long && route.faAt
          ? ` · ${new Date(route.faAt).toLocaleDateString()}`
          : ""}
      </span>
    );
  return <span className="badge beta">🎬 beta</span>;
}

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
  const [routes, setRoutes] = useState([]);
  const [openRoute, setOpenRoute] = useState(null); // full route with sends
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [gradeRange, setGradeRange] = useState([0, 17]);
  const [tagFilter, setTagFilter] = useState([]);
  const [sort, setSort] = useState("new");
  const wall = useWall();

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
  const sortCmp = SORTS.find((s) => s.key === sort).cmp;
  if (sortCmp) filtered.sort(sortCmp);
  const hasFilter = lo > 0 || hi < 17 || tagFilter.length > 0 || sort !== "new";

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
        <button className="add-route-btn" onClick={() => setAdding(true)}>
          + Add route
        </button>
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
              setSort("new");
            }}
          >
            reset
          </button>
        )}
      </div>
      <div className="tag-chips rating-filter">
        <span className="muted">Sort:</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`tag-chip ${sort === s.key ? "on" : ""}`}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
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
        <p className="muted">No routes yet. Set one!</p>
      )}
      {routes.length > 0 && filtered.length === 0 && (
        <p className="muted">No routes match the current filters.</p>
      )}

      <div className="route-grid">
        {filtered.map((r) => (
          <div key={r.id} className="route-card" onClick={() => open(r.id)}>
            <RouteImage route={r} wall={wall} lazy />
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
                <StatusBadge route={r} />
                <RatingBadge route={r} />
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
          wall={wall}
          user={user}
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
          wall={wall}
          user={user}
          onToggleFavorite={() => toggleFavorite(openRoute.id)}
          onClose={() => setOpenRoute(null)}
          onChanged={async () => {
            await open(openRoute.id);
            refresh();
          }}
          onDeleted={() => {
            setOpenRoute(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}

// Tap a hold on the wall, then pick what it's for
function WallSetter({ wall, holds, onChange }) {
  const [picking, setPicking] = useState(null); // { id, x, y } in % of the wall
  const [zoom, setZoom] = useState(1);

  function tapHold(h, e) {
    e.stopPropagation();
    const xs = h.points.map((p) => p[0]);
    const ys = h.points.map((p) => p[1]);
    setPicking({
      id: h.id,
      // Keep the picker from hanging off the sides of the wall
      x: Math.min(82, Math.max(18, ((Math.min(...xs) + Math.max(...xs)) / 2) * 100)),
      y: Math.max(...ys) * 100, // just under the hold
      above: Math.max(...ys) > 0.8, // ...unless that runs off the bottom
      top: Math.min(...ys) * 100,
    });
  }

  function pick(role) {
    const next = { ...holds };
    if (role) next[picking.id] = role;
    else delete next[picking.id];
    onChange(next);
    setPicking(null);
  }

  return (
    <div className="wall-setter">
      <div className="wall-setter-bar">
        <RoleLegend holds={holds} />
        <span className="wall-setter-zoom">
          {[1, 2, 3].map((z) => (
            <button
              type="button"
              key={z}
              className={zoom === z ? "on" : ""}
              onClick={() => setZoom(z)}
            >
              {z}×
            </button>
          ))}
        </span>
      </div>
      <div className="wall-setter-scroll">
        <div
          className="wall-setter-canvas"
          style={{ width: `${zoom * 100}%` }}
          onClick={() => setPicking(null)}
        >
          <WallView wall={wall} holds={holds} showAll onTapHold={tapHold} />
          {picking && (
            <div
              className={`hold-picker ${picking.above ? "above" : ""}`}
              style={{
                left: `${picking.x}%`,
                top: `${picking.above ? picking.top : picking.y}%`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r}
                  className={holds[picking.id] === r ? "on" : ""}
                  style={{ borderColor: ROLE_COLORS[r] }}
                  onClick={() => pick(holds[picking.id] === r ? null : r)}
                >
                  {r}
                </button>
              ))}
              {holds[picking.id] && (
                <button type="button" onClick={() => pick(null)} title="Remove">
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// New routes are set on the shared wall and stored as hold data only, so
// adding one never uploads an image
function AddRouteModal({ wall, user, onClose, onAdded }) {
  useScrollLock();
  const formRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [holds, setHolds] = useState({}); // { holdId: role }
  const canSet = wall?.holds?.length > 0;
  const problem = holdProblem(holds);

  async function submit(e) {
    e.preventDefault();
    if (problem) return setError(problem);
    setError("");
    const fd = new FormData(formRef.current);
    setSaving(true);
    try {
      await api.addRoute({
        title: fd.get("title"),
        setter: (fd.get("setter") || "").trim(),
        grade: fd.get("grade"),
        match: fd.get("match") === "on",
        notes: fd.get("notes"),
        holds: Object.entries(holds).map(([hold, role]) => ({ hold, role })),
      });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${canSet ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h3>Add a route</h3>
        {!canSet ? (
          <p className="muted">
            Routes are set on the wall photo. Trace the wall's holds first, from
            Dashboard → Wall hold map.
          </p>
        ) : (
          <form ref={formRef} onSubmit={submit}>
            <input name="title" placeholder="Route name" required />
            <input
              name="setter"
              placeholder={user ? `Setter (defaults to ${user.name})` : "Setter name"}
              required={!user}
            />
            <input name="grade" placeholder="Proposed grade (e.g. V6)" />
            <label className="check-label">
              <input name="match" type="checkbox" defaultChecked />
              Matching allowed
            </label>
            <textarea name="notes" rows={2} placeholder="Beta / description (optional)" />
            <WallSetter wall={wall} holds={holds} onChange={setHolds} />
            <button
              type="submit"
              disabled={saving || !!problem}
              title={problem || undefined}
            >
              {saving ? "Saving…" : "Add to gallery"}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function RouteDetail({
  route,
  wall,
  user,
  onToggleFavorite,
  onClose,
  onChanged,
  onDeleted,
}) {
  useScrollLock();
  const signedIn = user != null;
  const [progress, setProgress] = useState(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [showBeta, setShowBeta] = useState(false);
  const [sendGrade, setSendGrade] = useState(null); // no default — V0 is a real answer
  const [sendVote, setSendVote] = useState(null); // 1, -1, or no rating

  async function rate(v) {
    try {
      await api.vote(route.id, route.myVote === v ? 0 : v);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }
  const formRef = useRef(null);
  // Coaches can delete any route; its setter only until someone sends it
  const canDelete =
    user &&
    (user.role === "coach" ||
      (route.owner === user.id && route.sends.length === 0));

  async function deleteRoute() {
    if (!confirm(`Delete "${route.title}"?`)) return;
    try {
      await api.deleteRoute(route.id);
      onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitSend(e) {
    e.preventDefault();
    const fd = new FormData(formRef.current);
    const file = fd.get("video");
    const author = user?.name || (fd.get("author") || "").trim();
    const attempts = fd.get("attempts");
    if (!author) return setError("Add your name.");
    if (!attempts || Number(attempts) < 1)
      return setError("How many attempts did it take?");
    setError("");
    try {
      let videoUrl = null;
      let posterUrl = null;
      if (file?.name) {
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
        videoUrl = await api.uploadFile(clip, setProgress);
        posterUrl = poster
          ? await api.uploadFile(poster).catch(() => null)
          : null;
      }

      setStage("Saving…");
      setProgress(null);
      const { claimedFa, claimedBounty } = await api.addSend(route.id, {
        videoUrl,
        posterUrl,
        author,
        grade: sendGrade,
        vote: sendVote,
        attempts: Number(attempts),
      });
      if (claimedBounty) alert("🎉 First ascent — you mogged the setter!");
      else if (claimedFa) alert("🎉 First ascent! Your name's on it.");
      formRef.current.reset();
      setSendGrade(null); // form.reset() doesn't touch React state
      setSendVote(null);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
      setStage("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal route-detail" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="route-detail-layout">
          {route.holds?.length ? (
            <div>
              <WallView
                wall={wall}
                holds={holdMap(route.holds)}
                dim
                className="route-hero"
              />
              <RoleLegend />
            </div>
          ) : (
            <img className="route-hero" src={route.imageUrl} alt={route.title} />
          )}
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
              <span className="badge grade" title="Set by the setter">
                {route.displayGrade || route.grade}
              </span>
              {route.suggested && (
                <span
                  className="badge"
                  title={`What ${route.suggested.count} sender${route.suggested.count === 1 ? "" : "s"} thought — advisory only`}
                >
                  senders say V{route.suggested.avg}
                </span>
              )}
              <StatusBadge route={route} long />
              <RatingBadge route={route} />
            </div>
            {route.hasSent && (
              <div className="vote-row">
                <span className="muted">You sent it — rate it:</span>
                {[1, -1].map((v) => (
                  <button
                    key={v}
                    className={`vote-btn ${route.myVote === v ? "on" : ""}`}
                    onClick={() => rate(v)}
                    aria-pressed={route.myVote === v}
                  >
                    {v === 1 ? "👍" : "👎"}
                  </button>
                ))}
              </div>
            )}
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
            {route.setter && <p className="muted">Set by {route.setter}</p>}
            {route.notes && <p className="muted">{route.notes}</p>}
            {canDelete && (
              <button className="link-btn danger-link" onClick={deleteRoute}>
                🗑 Delete route
              </button>
            )}

            {route.betaVideoUrl ? (
              <div className={`beta-panel ${showBeta ? "open" : ""}`}>
                <button
                  className="beta-toggle"
                  onClick={() => setShowBeta(!showBeta)}
                  aria-expanded={showBeta}
                >
                  <span>
                    🎬 Beta video{route.betaBy ? ` · ${route.betaBy}` : ""}
                  </span>
                  <span className="faq-chevron">{showBeta ? "−" : "+"}</span>
                </button>
                {showBeta && (
                  <LazyVideo
                    src={route.betaVideoUrl}
                    poster={route.betaPosterUrl}
                  />
                )}
              </div>
            ) : (
              <p className="muted">
                💰 No beta yet — the setter hasn't shown this one goes. Send it
                and both the FA and the beta are yours.
              </p>
            )}

            <h4>Sends ({route.sends.length})</h4>
            {route.sends.length === 0 && (
              <p className="muted">
                No one has done this yet — send it and claim the FA.
              </p>
            )}
            <div className="send-list">
              {route.sends.map((s) => (
                <div key={s.id} className="send">
                  {s.videoUrl && (
                    <LazyVideo src={s.videoUrl} poster={s.posterUrl} />
                  )}
                  <span className="muted">
                    {s.author}
                    {s.attempts != null &&
                      ` · ${s.attempts === 1 ? "⚡ flash" : `${s.attempts} attempts`}`}
                    {s.grade != null && ` · called it V${s.grade}`}
                    {s.vote === 1 && " · 👍"}
                    {s.vote === -1 && " · 👎"}
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
              <div className="grade-picker">
                <span className="muted">
                  What did you think it was?{" "}
                  {sendGrade === null ? "(optional)" : `— V${sendGrade}`}
                </span>
                <div className="grade-chips">
                  {Array.from({ length: 18 }, (_, i) => (
                    <button
                      type="button"
                      key={i}
                      className={`grade-chip ${sendGrade === i ? "on" : ""}`}
                      onClick={() => setSendGrade(sendGrade === i ? null : i)}
                    >
                      V{i}
                    </button>
                  ))}
                </div>
              </div>
              <div className="vote-row">
                <span className="muted">Rate it (optional):</span>
                {[1, -1].map((v) => (
                  <button
                    type="button"
                    key={v}
                    className={`vote-btn ${sendVote === v ? "on" : ""}`}
                    onClick={() => setSendVote(sendVote === v ? null : v)}
                    aria-pressed={sendVote === v}
                  >
                    {v === 1 ? "👍" : "👎"}
                  </button>
                ))}
              </div>
              <label className="muted">
                Got a video? Add it (optional) — keep it under 30 seconds, it
                gets shrunk before uploading:
                <input name="video" type="file" accept="video/*" />
              </label>
              <button type="submit" disabled={stage !== ""}>
                {progress !== null
                  ? `${stage} ${Math.round(progress * 100)}%`
                  : stage ||
                    (route.status === "bounty"
                      ? "Submit send & claim FA"
                      : "Submit send")}
              </button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
