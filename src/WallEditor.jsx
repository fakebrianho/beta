import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { toDisplayableImage } from "./image.js";

const CLOSE_PX = 12; // clicking this close to the first point closes the hold
const ZOOMS = [1, 1.5, 2, 3, 4];

const newId = () => Math.random().toString(36).slice(2, 10);
const toPoints = (pts) => pts.map((p) => p.join(",")).join(" ");

// Coach tool for tracing every hold on the wall photo once. Holds are stored
// as polygons in 0..1 image coordinates, so they line up at any screen size.
export default function WallEditor({ onClose }) {
  const [wall, setWall] = useState(undefined); // undefined = loading, null = no wall yet
  const [holds, setHolds] = useState([]);
  const [draft, setDraft] = useState([]); // points of the hold being traced
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const svgRef = useRef(null);

  useEffect(() => {
    api
      .getWall()
      .then((w) => {
        setWall(w);
        setHolds(w?.holds || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const editHolds = (next) => {
    setHolds(next);
    setDirty(true);
  };

  function finishHold() {
    if (draft.length < 3) return;
    const id = newId();
    editHolds([...holds, { id, points: draft }]);
    setDraft([]);
    setSelected(id);
  }

  function deleteSelected() {
    if (!selected) return;
    editHolds(holds.filter((h) => h.id !== selected));
    setSelected(null);
  }

  function handleClick(e) {
    if (e.detail >= 2) return finishHold(); // second click of a double-click
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Not tracing: clicking a traced hold selects it
    const hit = e.target.dataset?.id;
    if (draft.length === 0 && hit) return setSelected(hit === selected ? null : hit);
    if (draft.length >= 3) {
      const [fx, fy] = draft[0];
      if (Math.hypot(fx * rect.width - x, fy * rect.height - y) < CLOSE_PX)
        return finishHold();
    }
    setSelected(null);
    setDraft([...draft, [x / rect.width, y / rect.height]]);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.closest?.("input, textarea")) return;
      if (e.key === "Enter") finishHold();
      else if (e.key === "Escape") {
        setDraft([]);
        setSelected(null);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (draft.length) setDraft(draft.slice(0, -1));
        else deleteSelected();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function save() {
    setBusy("Saving…");
    setError("");
    try {
      const w = await api.saveWall({ imageUrl: wall.imageUrl, holds });
      setWall(w);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  // A new photo means new hold positions, so the old map is thrown away
  async function changePhoto(file) {
    if (!file) return;
    if (
      holds.length &&
      !confirm(`A new photo clears all ${holds.length} traced holds. Continue?`)
    )
      return;
    setBusy("Uploading photo…");
    setError("");
    try {
      const imageUrl = await api.uploadFile(await toDisplayableImage(file));
      const w = await api.saveWall({ imageUrl, holds: [] });
      setWall(w);
      setHolds([]);
      setDraft([]);
      setSelected(null);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  function close() {
    if (dirty && !confirm("Discard unsaved hold changes?")) return;
    onClose();
  }

  if (wall === undefined)
    return <p className="muted">{error || "Loading wall…"}</p>;

  return (
    <div className="wall-editor">
      <div className="wall-toolbar">
        <label className="photo-btn" title="Upload the wall photo">
          📷 {wall ? "Replace photo" : "Upload wall photo"}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              changePhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {wall && (
          <>
            <button
              onClick={() => setZoom(Math.max(0, zoom - 1))}
              disabled={zoom === 0}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="muted">{ZOOMS[zoom]}×</span>
            <button
              onClick={() => setZoom(Math.min(ZOOMS.length - 1, zoom + 1))}
              disabled={zoom === ZOOMS.length - 1}
              aria-label="Zoom in"
            >
              +
            </button>
            {draft.length > 0 ? (
              <>
                <button onClick={finishHold} disabled={draft.length < 3}>
                  ✓ Finish hold
                </button>
                <button onClick={() => setDraft(draft.slice(0, -1))}>
                  ↶ Undo point
                </button>
                <button onClick={() => setDraft([])}>Cancel</button>
              </>
            ) : (
              selected && (
                <button className="danger" onClick={deleteSelected}>
                  🗑 Delete hold
                </button>
              )
            )}
          </>
        )}
        <span className="wall-toolbar-end">
          {wall && (
            <button onClick={save} disabled={!dirty || !!busy}>
              {busy || (dirty ? "Save holds" : "Saved")}
            </button>
          )}
          <button onClick={close}>Close</button>
        </span>
      </div>

      {wall ? (
        <>
          <p className="muted">
            {holds.length} hold{holds.length === 1 ? "" : "s"} traced. Click
            around a hold's edge, then click the first point, double-click, or
            press Enter to close it. Click a traced hold to select it;
            Backspace undoes a point or deletes the selected hold.
          </p>
          <div className="wall-scroll">
            <div className="wall-canvas" style={{ width: `${ZOOMS[zoom] * 100}%` }}>
              <img src={wall.imageUrl} alt="Spray wall" draggable={false} />
              <svg
                ref={svgRef}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                onClick={handleClick}
              >
                {holds.map((h) => (
                  <polygon
                    key={h.id}
                    data-id={h.id}
                    points={toPoints(h.points)}
                    className={`hold-shape ${h.id === selected ? "selected" : ""}`}
                  />
                ))}
                {draft.length > 0 && (
                  <polyline points={toPoints(draft)} className="hold-draft" />
                )}
              </svg>
              {draft.map(([x, y], i) => (
                <span
                  key={i}
                  className={`hold-vertex ${i === 0 && draft.length >= 3 ? "closer" : ""}`}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="muted">
          Upload a straight-on photo of the whole wall to start tracing holds.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
