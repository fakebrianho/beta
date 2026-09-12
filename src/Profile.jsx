import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { TAG_COLORS } from "./tags.js";

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

export default function Profile({ userId, onOpenRoute }) {
  const [p, setProfile] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("sends");

  useEffect(() => {
    setProfile(null);
    api.profile(userId).then(setProfile).catch((e) => setError(e.message));
  }, [userId]);

  if (error) return <main className="dashboard"><p className="error">{error}</p></main>;
  if (!p) return <main className="dashboard" />;

  const list = tab === "sends" ? p.sends : p.favorites;

  return (
    <main className="dashboard profile">
      <div className="profile-head">
        <div className="avatar">{p.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <h2>{p.name}</h2>
          <span className="muted">
            {p.points.toLocaleString()} pts
            {p.rank && ` · rank #${p.rank}`} · {p.sends.length} send
            {p.sends.length === 1 ? "" : "s"}
            {p.sends.some((s) => s.fa) &&
              ` · ${p.sends.filter((s) => s.fa).length} FA`}
          </span>
        </div>
      </div>

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
