import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import AuthPage from "./AuthPage.jsx";
import Dashboard from "./Dashboard.jsx";
import ReviewPage from "./ReviewPage.jsx";
import Gallery from "./Gallery.jsx";
import Faq from "./Faq.jsx";
import Leaderboard from "./Leaderboard.jsx";
import Profile from "./Profile.jsx";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [activeVideoId, setActiveVideoId] = useState(null);
  // Signed out: gallery is public, dashboard requires sign-in
  const [tab, setTab] = useState("gallery"); // "dashboard" | "gallery"
  const [showAuth, setShowAuth] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileId, setProfileId] = useState(null); // null = own profile
  const [galleryRouteId, setGalleryRouteId] = useState(null);

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
    setMenuOpen(false);
  }

  async function choosePassword() {
    const pw = prompt(
      "Choose a password (6+ characters) so you can also log in without an email link:"
    );
    if (!pw) return;
    try {
      setUser(await api.setPassword(pw));
      alert("Password set — you can now log in with email + password.");
    } catch (e) {
      alert(e.message);
    }
  }

  if (user === undefined) return null;

  const goTo = (t) => {
    setActiveVideoId(null);
    setShowAuth(false);
    setMenuOpen(false);
    if (t !== "gallery") setGalleryRouteId(null);
    if (t !== "profile") setProfileId(null);
    setTab(t);
  };

  // Open someone's profile from the leaderboard, or a route from a profile
  const openProfile = (id) => {
    setProfileId(id && id !== user?.id ? id : null);
    goTo("profile");
  };
  const openRouteInGallery = (id) => {
    setGalleryRouteId(id);
    setActiveVideoId(null);
    setMenuOpen(false);
    setTab("gallery");
  };

  const TABS = [
    { key: "dashboard", label: "Dashboard", signedInOnly: true },
    { key: "gallery", label: "Gallery" },
    { key: "leaderboard", label: "Leaderboard" },
    { key: "profile", label: "Profile", signedInOnly: true },
    { key: "faq", label: "FAQ" },
  ].filter((t) => !t.signedInOnly || user);

  const isActive = (key) => tab === key && !activeVideoId && !showAuth;

  return (
    <div className="app">
      <header className="topbar">
        <div
          className="brand"
          onClick={() => goTo(user ? "dashboard" : "gallery")}
        >
          🧗 Beta
        </div>
        <nav className="role-toggle tabs desktop-only">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={isActive(t.key) ? "active" : ""}
              onClick={() => goTo(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {user ? (
          <div className="user-chip desktop-only">
            <span className="muted">
              {user.name} · {user.role}
            </span>
            {user.hasPassword === false && (
              <button onClick={choosePassword}>Set password</button>
            )}
            <button onClick={logout}>Sign out</button>
          </div>
        ) : (
          <button className="desktop-only" onClick={() => setShowAuth(true)}>
            Sign in
          </button>
        )}

        <button
          className="hamburger"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "✕" : "☰"}
        </button>

        {menuOpen && (
          <div className="mobile-menu">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={isActive(t.key) ? "active" : ""}
                onClick={() => goTo(t.key)}
              >
                {t.label}
              </button>
            ))}
            <div className="mobile-menu-sep" />
            {user ? (
              <>
                <span className="muted">
                  {user.name} · {user.role}
                </span>
                {user.hasPassword === false && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      choosePassword();
                    }}
                  >
                    Set password
                  </button>
                )}
                <button onClick={logout}>Sign out</button>
              </>
            ) : (
              <button
                onClick={() => {
                  setShowAuth(true);
                  setMenuOpen(false);
                }}
              >
                Sign in
              </button>
            )}
          </div>
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
      ) : tab === "faq" ? (
        <Faq />
      ) : tab === "leaderboard" ? (
        <Leaderboard role={user?.role} onOpenProfile={openProfile} />
      ) : tab === "profile" && (user || profileId) ? (
        <Profile userId={profileId} onOpenRoute={openRouteInGallery} />
      ) : tab === "gallery" ? (
        <Gallery
          user={user}
          initialRouteId={galleryRouteId}
          onConsumedInitialRoute={() => setGalleryRouteId(null)}
        />
      ) : (
        <Dashboard role={user.role} onOpen={setActiveVideoId} />
      )}
    </div>
  );
}
