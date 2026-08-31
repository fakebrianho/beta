import React, { useState } from "react";
import { api } from "./api.js";

export default function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "magic"
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [magicSent, setMagicSent] = useState(null); // { dev } after a link is sent
  const [needsProfile, setNeedsProfile] = useState(false); // magic signup for a new email

  function switchMode(m) {
    setMode(m);
    setError("");
    setMagicSent(null);
    setNeedsProfile(false);
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (mode === "magic") {
        const res = await api.magicLink(
          needsProfile ? data : { email: data.email }
        );
        setMagicSent(res);
      } else {
        const user =
          mode === "signup" ? await api.signup(data) : await api.login(data);
        onAuthed(user);
      }
    } catch (err) {
      if (mode === "magic" && err.message === "new-user") {
        setNeedsProfile(true);
        setError("");
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    login: "Sign in",
    signup: "Create your account",
    magic: "Sign in with email link",
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <h2>{titles[mode]}</h2>

        {magicSent ? (
          <p>
            ✉️ Link sent! Check your email
            {magicSent.dev && (
              <span className="muted">
                {" "}
                (dev mode: no email service configured — the link was printed in
                the API server terminal)
              </span>
            )}
            . It expires in 15 minutes.
          </p>
        ) : (
          <form onSubmit={submit}>
            {(mode === "signup" || needsProfile) && (
              <>
                {needsProfile && (
                  <p className="muted">
                    New email — tell us who you are to finish signing up.
                  </p>
                )}
                <input name="name" placeholder="Your name" required />
              </>
            )}
            <input
              name="email"
              type="email"
              placeholder="Email"
              autoComplete="email"
              required
            />
            {mode !== "magic" && (
              <input
                name="password"
                type="password"
                placeholder={
                  mode === "signup" ? "Password (6+ characters)" : "Password"
                }
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={6}
                required
              />
            )}
            <button type="submit" disabled={busy}>
              {busy
                ? "…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Sign up"
                    : "Email me a sign-in link"}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}

        <div className="auth-links">
          {mode !== "magic" && (
            <button className="link-btn" onClick={() => switchMode("magic")}>
              ✉️ Use an email link instead (no password)
            </button>
          )}
          <p className="muted">
            {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              className="link-btn"
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
