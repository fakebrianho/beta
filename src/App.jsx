import React, { useState } from "react";
import Dashboard from "./Dashboard.jsx";
import ReviewPage from "./ReviewPage.jsx";

export default function App() {
  // Mock auth for now: a simple role toggle. Swap for real accounts later.
  const [role, setRole] = useState("coach"); // "coach" | "student"
  const [activeVideoId, setActiveVideoId] = useState(null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setActiveVideoId(null)}>
          🧗 Beta Coach
        </div>
        <div className="role-toggle">
          <button
            className={role === "student" ? "active" : ""}
            onClick={() => setRole("student")}
          >
            Student
          </button>
          <button
            className={role === "coach" ? "active" : ""}
            onClick={() => setRole("coach")}
          >
            Coach
          </button>
        </div>
      </header>
      {activeVideoId ? (
        <ReviewPage
          videoId={activeVideoId}
          role={role}
          onBack={() => setActiveVideoId(null)}
        />
      ) : (
        <Dashboard role={role} onOpen={setActiveVideoId} />
      )}
    </div>
  );
}
