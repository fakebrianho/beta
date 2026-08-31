import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import AuthPage from "./AuthPage.jsx";
import Dashboard from "./Dashboard.jsx";
import ReviewPage from "./ReviewPage.jsx";
import Gallery from "./Gallery.jsx";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [activeVideoId, setActiveVideoId] = useState(null);
  // Signed out: gallery is public, dashboard requires sign-in
  const [tab, setTab] = useState("gallery"); // "dashboard" | "gallery"
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    api.me().then((u) => {
      setUser(u);
      if (u) setTab("dashboard");
    });
  }, []);

  async function logout() {
    await api.logout();
    setUser(null);
    setActiveVideoId(null);
    setTab("gallery");
  }

  if (user === undefined) return null;

  const goTo = (t) => {
    setActiveVideoId(null);
    setShowAuth(false);
    setTab(t);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div
          className="brand"
          onClick={() => goTo(user ? "dashboard" : "gallery")}
        >
          🧗 Beta
        </div>
        <nav className="role-toggle tabs">
          {user && (
            <button
              className={tab === "dashboard" && !activeVideoId ? "active" : ""}
              onClick={() => goTo("dashboard")}
            >
              Dashboard
            </button>
          )}
          <button
            className={
              tab === "gallery" && !activeVideoId && !showAuth ? "active" : ""
            }
            onClick={() => goTo("gallery")}
          >
            Gallery
          </button>
        </nav>
        {user ? (
          <div className="user-chip">
            <span className="muted">
              {user.name} · {user.role}
            </span>
            <button onClick={logout}>Sign out</button>
          </div>
        ) : (
          <button onClick={() => setShowAuth(true)}>Sign in</button>
        )}
      </header>
      {!user && showAuth ? (
        <AuthPage
          onAuthed={(u) => {
            setUser(u);
            setShowAuth(false);
            setTab("dashboard");
          }}
        />
      ) : user && activeVideoId ? (
        <ReviewPage
          videoId={activeVideoId}
          role={user.role}
          onBack={() => setActiveVideoId(null)}
        />
      ) : tab === "gallery" ? (
        <Gallery role={user?.role || null} />
      ) : (
        <Dashboard role={user.role} onOpen={setActiveVideoId} />
      )}
    </div>
  );
}
