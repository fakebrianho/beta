import React, { useEffect, useState } from "react";
import { api } from "./api.js";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Leaderboard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.leaderboard().then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <main className="dashboard leaderboard">
      <h2>Leaderboard</h2>
      <p className="muted">
        FA = 5000 pts · flash = 3000 · 2nd go = 2000 · 3rd = 1000 · after that
        it decays. Sign up and log your sends to get on the board.
      </p>
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && (
        <p className="muted">Nobody on the board yet — go claim a bounty.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="lb-table">
          <div className="lb-row lb-head">
            <span>#</span>
            <span>Climber</span>
            <span>Points</span>
            <span>Sends</span>
            <span>FAs</span>
          </div>
          {rows.map((r) => (
            <div key={r.rank} className={`lb-row ${r.rank <= 3 ? "top" : ""}`}>
              <span>{MEDALS[r.rank - 1] || r.rank}</span>
              <span className="lb-name">{r.name}</span>
              <span className="lb-points">{r.points.toLocaleString()}</span>
              <span>{r.sends}</span>
              <span>{r.fas || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
