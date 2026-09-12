import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { Avatar } from "./Profile.jsx";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Leaderboard({ role, onOpenProfile }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const isCoach = role === "coach";

  useEffect(() => {
    api.leaderboard().then(setRows).catch((e) => setError(e.message));
  }, []);

  async function editScore(r) {
    const input = prompt(
      `Total points for ${r.name}.\nEarned from sends: ${r.earned.toLocaleString()}` +
        (r.adjustment ? ` · current manual adjustment: ${r.adjustment > 0 ? "+" : ""}${r.adjustment}` : ""),
      r.points
    );
    if (input === null) return;
    try {
      setRows(await api.setUserPoints(r.id, Number(input)));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="dashboard leaderboard">
      <h2>Leaderboard</h2>
      <p className="muted">
        Base = grade × 1000 (V0 counts as 1000). Flash adds a 1000 bonus with no
        attempt penalty; otherwise it's base − 100 × attempts. An FA adds 1000.
        Sign up and log your sends to get on the board.
      </p>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && (
        <p className="muted">Nobody on the board yet — go claim a bounty.</p>
      )}
      {rows && rows.length > 0 && (
        <div className={`lb-table ${isCoach ? "admin" : ""}`}>
          <div className="lb-row lb-head">
            <span>#</span>
            <span>Climber</span>
            <span>Points</span>
            <span>Sends</span>
            <span>FAs</span>
            {isCoach && <span />}
          </div>
          {rows.map((r) => (
            <div key={r.id} className={`lb-row ${r.rank <= 3 ? "top" : ""}`}>
              <span>{MEDALS[r.rank - 1] || r.rank}</span>
              <span
                className={`lb-name ${onOpenProfile ? "clickable" : ""}`}
                onClick={() => onOpenProfile?.(r.id)}
              >
                <Avatar name={r.name} url={r.avatarUrl} size={26} />
                {r.name}
              </span>
              <span className="lb-points">
                {r.points.toLocaleString()}
                {r.adjustment !== 0 && (
                  <small
                    className="lb-adj"
                    title={`${r.earned.toLocaleString()} earned, manually adjusted by ${r.adjustment}`}
                  >
                    {r.adjustment > 0 ? "+" : ""}
                    {r.adjustment}
                  </small>
                )}
              </span>
              <span>{r.sends}</span>
              <span>{r.fas || "—"}</span>
              {isCoach && (
                <button
                  className="lb-edit"
                  title="Edit this score"
                  onClick={() => editScore(r)}
                >
                  ✎
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
