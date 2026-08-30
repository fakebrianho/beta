import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import AuthPage from "./AuthPage.jsx";
import Dashboard from "./Dashboard.jsx";
import ReviewPage from "./ReviewPage.jsx";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [activeVideoId, setActiveVideoId] = useState(null);

  useEffect(() => {
    api.me().then(setUser);
  }, []);

  async function logout() {
    await api.logout();
    setUser(null);
    setActiveVideoId(null);
  }

  if (user === undefined) return null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setActiveVideoId(null)}>
          🧗 Beta Coach
        </div>
        {user && (
          <div className="user-chip">
            <span className="muted">
              {user.name} · {user.role}
            </span>
            <button onClick={logout}>Sign out</button>
          </div>
        )}
      </header>
      {!user ? (
        <AuthPage onAuthed={setUser} />
      ) : activeVideoId ? (
        <ReviewPage
          videoId={activeVideoId}
          role={user.role}
          onBack={() => setActiveVideoId(null)}
        />
      ) : (
        <Dashboard role={user.role} onOpen={setActiveVideoId} />
      )}
    </div>
  );
}
