import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

// Browsers can't render HEIC (iPhone photos) — re-encode to JPEG before
// upload. Prefer the browser's native decoder (Safari reads HEIC directly,
// and this also downscales huge photos); fall back to heic2any's libheif.
const MAX_DIM = 2000;

async function encodeJpeg(source, name) {
  const scale = Math.min(1, MAX_DIM / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) =>
    canvas.toBlob(res, "image/jpeg", 0.85)
  );
  if (!blob) throw new Error("encode failed");
  return new File([blob], name.replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
  });
}

async function toDisplayableImage(file) {
  // Native decode first — works for jpg/png everywhere and HEIC on Safari
  try {
    const bmp = await createImageBitmap(file);
    const out = await encodeJpeg(bmp, file.name);
    bmp.close();
    return out;
  } catch {
    /* browser can't decode this format */
  }
  try {
    const { default: heic2any } = await import("heic2any");
    let blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    if (Array.isArray(blob)) blob = blob[0]; // multi-image HEIC (e.g. bursts)
    const bmp = await createImageBitmap(blob);
    const out = await encodeJpeg(bmp, file.name);
    bmp.close();
    return out;
  } catch {
    throw new Error(
      "Couldn't read this image. Try exporting it as JPEG or PNG first (on iPhone: Settings → Camera → Formats → Most Compatible, or share via Photos which converts automatically)."
    );
  }
}

export default function Gallery({ user }) {
  const role = user?.role || null;
  const [routes, setRoutes] = useState([]);
  const [openRoute, setOpenRoute] = useState(null); // full route with sends
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    api.listRoutes().then(setRoutes).catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);

  async function open(id) {
    setOpenRoute(await api.getRoute(id));
  }

  return (
    <main className="dashboard">
      <div className="gallery-head">
        <h2>Route gallery</h2>
        {role === "coach" && (
          <button className="add-route-btn" onClick={() => setAdding(true)}>
            + Add route
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {routes.length === 0 && (
        <p className="muted">No routes yet. Coaches can add one.</p>
      )}

      <div className="route-grid">
        {routes.map((r) => (
          <div key={r.id} className="route-card" onClick={() => open(r.id)}>
            <img src={r.imageUrl} alt={r.title} loading="lazy" />
            <div className="route-card-overlay">
              <strong>
                {r.title} · {r.match ? "match" : "no match"}
              </strong>
              <div className="badges">
                <span className="badge grade">{r.displayGrade || r.grade}</span>
                {r.status === "bounty" ? (
                  <span className="badge bounty">💰 Bounty</span>
                ) : (
                  <span className="badge fa">✓ FA · {r.faBy}</span>
                )}
                {r.sendCount > 0 && (
                  <span className="badge">{r.sendCount} send{r.sendCount > 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <AddRouteModal
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {openRoute && (
        <RouteDetail
          route={openRoute}
          user={user}
          onClose={() => setOpenRoute(null)}
          onChanged={async () => {
            await open(openRoute.id);
            refresh();
          }}
        />
      )}
    </main>
  );
}

function AddRouteModal({ onClose, onAdded }) {
  const formRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    const fd = new FormData(formRef.current);
    const image = fd.get("image");
    if (!image?.name) return setError("Pick a hero image first.");
    try {
      setProgress(0);
      const imageUrl = await api.uploadFile(
        await toDisplayableImage(image),
        setProgress
      );
      await api.addRoute({
        title: fd.get("title"),
        grade: fd.get("grade"),
        match: fd.get("match") === "on",
        notes: fd.get("notes"),
        imageUrl,
      });
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a route</h3>
        <form ref={formRef} onSubmit={submit}>
          <input name="title" placeholder="Route name" required />
          <input name="grade" placeholder="Proposed grade (e.g. V6)" />
          <label className="check-label">
            <input name="match" type="checkbox" defaultChecked />
            Matching allowed
          </label>
          <textarea name="notes" rows={2} placeholder="Beta / description (optional)" />
          <label className="muted">
            Hero image (vertical works best)
            <input name="image" type="file" accept="image/*" required />
          </label>
          <button type="submit" disabled={progress !== null}>
            {progress !== null
              ? `Uploading… ${Math.round(progress * 100)}%`
              : "Add to gallery"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function RouteDetail({ route, user, onClose, onChanged }) {
  const signedIn = user != null;
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const formRef = useRef(null);

  async function submitSend(e) {
    e.preventDefault();
    const fd = new FormData(formRef.current);
    const file = fd.get("video");
    const author = user?.name || (fd.get("author") || "").trim();
    const passcode = (fd.get("passcode") || "").trim();
    const grade = fd.get("grade");
    if (!file?.name) return setError("A send video is required.");
    if (!author) return setError("Add your name.");
    setError("");
    try {
      await api.checkPasscode(passcode); // fail fast before the big upload
      setProgress(0);
      const videoUrl = await api.uploadFile(file, setProgress, passcode);
      const { claimedFa } = await api.addSend(route.id, {
        videoUrl,
        author,
        passcode,
        grade: grade === "" ? null : Number(grade),
      });
      if (claimedFa) alert("🎉 First ascent! The bounty is yours.");
      formRef.current.reset();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal route-detail" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="route-detail-layout">
          <img className="route-hero" src={route.imageUrl} alt={route.title} />
          <div className="route-info">
            <h3>
              {route.title} · {route.match ? "match" : "no match"}
            </h3>
            <div className="badges">
              <span className="badge grade" title={`Proposed: ${route.grade}`}>
                {route.displayGrade || route.grade}
              </span>
              {route.status === "bounty" ? (
                <span className="badge bounty">💰 Bounty — unclaimed</span>
              ) : (
                <span className="badge fa">
                  ✓ FA by {route.faBy}
                  {route.faAt && ` · ${new Date(route.faAt).toLocaleDateString()}`}
                </span>
              )}
            </div>
            {route.notes && <p className="muted">{route.notes}</p>}

            <h4>Sends ({route.sends.length})</h4>
            {route.sends.length === 0 && (
              <p className="muted">
                No one has done this yet — send it and claim the FA.
              </p>
            )}
            <div className="send-list">
              {route.sends.map((s) => (
                <div key={s.id} className="send">
                  <video src={s.videoUrl} controls preload="metadata" />
                  <span className="muted">
                    {s.author}
                    {s.grade != null && ` · called it V${s.grade}`} ·{" "}
                    {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>

            <form className="send-form" ref={formRef} onSubmit={submitSend}>
              <input
                name="author"
                placeholder="Your name"
                required
                defaultValue={user?.name || ""}
                readOnly={signedIn}
                className={signedIn ? "locked" : ""}
                title={signedIn ? "Posting as your account" : undefined}
              />
              <select name="grade" defaultValue="">
                <option value="">Your grade opinion (optional)</option>
                {Array.from({ length: 18 }, (_, i) => (
                  <option key={i} value={i}>
                    V{i}
                  </option>
                ))}
              </select>
              {!signedIn && (
                <input
                  name="passcode"
                  placeholder="Gym passcode"
                  autoComplete="off"
                  required
                />
              )}
              <label className="muted">
                Did it? Upload your send video (required):
                <input name="video" type="file" accept="video/*" required />
              </label>
              <button type="submit" disabled={progress !== null}>
                {progress !== null
                  ? `Uploading… ${Math.round(progress * 100)}%`
                  : route.status === "bounty"
                    ? "Submit send & claim FA"
                    : "Submit send"}
              </button>
            </form>
            {error && <p className="error">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
