import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import AuthPage from "./AuthPage.jsx";
import Dashboard from "./Dashboard.jsx";
import ReviewPage from "./ReviewPage.jsx";
import Gallery from "./Gallery.jsx";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [tab, setTab] = useState("dashboard"); // "dashboard" | "gallery"

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
        <div
          className="brand"
          onClick={() => {
            setActiveVideoId(null);
            setTab("dashboard");
          }}
        >
          🧗 Beta
        </div>
        {user && (
          <nav className="role-toggle tabs">
            <button
              className={tab === "dashboard" && !activeVideoId ? "active" : ""}
              onClick={() => {
                setActiveVideoId(null);
                setTab("dashboard");
              }}
            >
              Dashboard
            </button>
            <button
              className={tab === "gallery" && !activeVideoId ? "active" : ""}
              onClick={() => {
                setActiveVideoId(null);
                setTab("gallery");
              }}
            >
              Gallery
            </button>
          </nav>
        )}
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
      ) : tab === "gallery" ? (
        <Gallery role={user.role} />
      ) : (
        <Dashboard role={user.role} onOpen={setActiveVideoId} />
      )}
    </div>
  );
}
