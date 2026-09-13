import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { toDisplayableImage } from "./image.js";
import { TAG_COLORS } from "./tags.js";

export function Avatar({ name, url, size }) {
  const style = size ? { width: size, height: size, fontSize: size / 2.4 } : null;
  return url ? (
    <img className="avatar" src={url} alt={name} style={style} />
  ) : (
    <div className="avatar" style={style}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function RouteTile({ route, onOpen }) {
  return (
    <div className="mini-route" onClick={() => onOpen?.(route.id)}>
      <img src={route.imageUrl} alt="" loading="lazy" />
      <div className="mini-route-body">
        <strong>{route.title}</strong>
        <div className="badges">
          <span className="badge grade">{route.displayGrade}</span>
          {route.status === "bounty" && (
            <span className="badge bounty">💰</span>
          )}
          <span className="tag-dots">
            {route.tags?.map((t) => (
              <span
                key={t}
                className="tag-dot"
                style={{ background: TAG_COLORS[t] }}
                title={t}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Profile({ userId, onOpenRoute, onAvatarChange }) {
  const [p, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("sends");
  const [busy, setBusy] = useState(false);

  async function uploadAvatar(file) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const avatarUrl = await api.uploadFile(await toDisplayableImage(file));
      const me = await api.updateProfile({ avatarUrl });
      setProfile((prev) => ({ ...prev, avatarUrl: me.avatarUrl }));
      onAvatarChange?.(me);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    try {
      const me = await api.updateProfile({ avatarUrl: null });
      setProfile((prev) => ({ ...prev, avatarUrl: null }));
      onAvatarChange?.(me);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    setProfile(null);
    api.profile(userId).then(setProfile).catch((e) => setError(e.message));
  }, [userId]);

  // an upload error shouldn't blow away the loaded profile
  if (!p)
    return (
      <main className="dashboard">
        {error && <p className="error">{error}</p>}
      </main>
    );

  const list = tab === "sends" ? p.sends : p.favorites;

  return (
    <main className="dashboard profile">
      <div className="profile-head">
        {p.isSelf ? (
          <label
            className={`avatar-edit ${busy ? "busy" : ""}`}
            title="Change profile picture"
          >
            <Avatar name={p.name} url={p.avatarUrl} />
            <span className="avatar-overlay">{busy ? "…" : "📷"}</span>
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={(e) => {
                uploadAvatar(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <Avatar name={p.name} url={p.avatarUrl} />
        )}
        <div>
          <h2>{p.name}</h2>
          <span className="muted">
            {p.points.toLocaleString()} pts
            {p.rank && ` · rank #${p.rank}`} · {p.sends.length} send
            {p.sends.length === 1 ? "" : "s"}
          </span>
          {(p.fas > 0 || p.bounties > 0) && (
            <div className="badges">
              {p.fas > 0 && (
                <span className="badge fa" title="First ascents">
                  🥇 {p.fas} FA{p.fas === 1 ? "" : "s"}
                </span>
              )}
              {p.bounties > 0 && (
                <span
                  className="badge bounty"
                  title="Sent it before the setter did"
                >
                  💰 {p.bounties} bount{p.bounties === 1 ? "y" : "ies"} claimed
                </span>
              )}
            </div>
          )}
          {p.isSelf && p.avatarUrl && (
            <button className="link-btn" onClick={removeAvatar} disabled={busy}>
              remove photo
            </button>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="role-toggle profile-tabs">
        <button
          className={tab === "sends" ? "active" : ""}
          onClick={() => setTab("sends")}
        >
          Sends ({p.sends.length})
        </button>
        {p.isSelf && (
          <button
            className={tab === "favorites" ? "active" : ""}
            onClick={() => setTab("favorites")}
          >
            ♥ Favorites ({p.favorites.length})
          </button>
        )}
      </div>

      {list.length === 0 && (
        <p className="muted">
          {tab === "sends"
            ? "No sends logged yet — go do a climb in the gallery."
            : "No favorites yet — tap the ♡ on any route to save it here."}
        </p>
      )}

      {tab === "sends" ? (
        <div className="send-history">
          {p.sends.map((s) => (
            <div key={s.id} className="send-history-row">
              <RouteTile route={s.route} onOpen={onOpenRoute} />
              <div className="send-history-meta">
                <span className="lb-points">{s.points.toLocaleString()} pts</span>
                <span className="muted">
                  {s.fa && "🥇 FA · "}
                  {s.attempts === 1
                    ? "⚡ flash"
                    : `${s.attempts ?? "?"} attempts`}
                  {s.grade != null && ` · called it V${s.grade}`}
                </span>
                <span className="muted">
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="fav-grid">
          {p.favorites.map((r) => (
            <RouteTile key={r.id} route={r} onOpen={onOpenRoute} />
          ))}
        </div>
      )}
    </main>
  );
}
