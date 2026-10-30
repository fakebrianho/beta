import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { toDisplayableImage } from "./image.js";
import { forgetWall } from "./WallView.jsx";

const MIN_STEP_PX = 2; // skip pointer samples closer than this to the last one
const CLICK_PX = 6; // a stroke shorter than this is a click, not a drawing
const SIMPLIFY_PX = 1.5; // how far the stored outline may stray from the stroke
const ZOOMS = [1, 1.5, 2, 3, 4];

const newId = () => Math.random().toString(36).slice(2, 10);
const toPoints = (pts) => pts.map((p) => p.join(",")).join(" ");

// Ramer–Douglas–Peucker: keep only the points that carry the shape, so a
// freehand stroke of hundreds of samples becomes a dozen or so
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay);
  let far = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = len
      ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
      : Math.hypot(px - ax, py - ay);
    if (d > far) [far, idx] = [d, i];
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [
    ...simplify(pts.slice(0, idx + 1), tol).slice(0, -1),
    ...simplify(pts.slice(idx), tol),
  ];
}

// Coach tool for tracing every hold on the wall photo once: draw around a
// hold freehand and letting go closes it. Holds are stored as polygons in
// 0..1 image coordinates, so they line up at any screen size.
export default function WallEditor({ onClose }) {
  const [wall, setWall] = useState(undefined); // undefined = loading, null = no wall yet
  const [holds, setHolds] = useState([]);
  const [draft, setDraft] = useState([]); // live stroke, for display only
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const svgRef = useRef(null);
  const stroke = useRef(null); // { rect, hit, points, length } while drawing

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

  function deleteSelected() {
    if (!selected) return;
    editHolds(holds.filter((h) => h.id !== selected));
    setSelected(null);
  }

  function pointerDown(e) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = svgRef.current.getBoundingClientRect();
    const points = [[e.clientX - rect.left, e.clientY - rect.top]];
    stroke.current = { rect, hit: e.target.dataset?.id, points, length: 0 };
    setDraft(points);
  }

  function pointerMove(e) {
    const s = stroke.current;
    if (!s) return;
    const p = [e.clientX - s.rect.left, e.clientY - s.rect.top];
    const [lx, ly] = s.points[s.points.length - 1];
    const step = Math.hypot(p[0] - lx, p[1] - ly);
    if (step < MIN_STEP_PX) return;
    s.length += step;
    s.points.push(p);
    setDraft([...s.points]);
  }

  function pointerUp() {
    const s = stroke.current;
    if (!s) return;
    stroke.current = null;
    setDraft([]);
    // Barely moved: treat it as a click, which selects the hold under it
    if (s.length < CLICK_PX) return setSelected(s.hit && s.hit !== selected ? s.hit : null);
    const outline = simplify(s.points, SIMPLIFY_PX);
    if (outline.length < 3) return;
    const id = newId();
    editHolds([
      ...holds,
      {
        id,
        points: outline.map(([x, y]) => [x / s.rect.width, y / s.rect.height]),
      },
    ]);
    setSelected(id);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.closest?.("input, textarea")) return;
      if (e.key === "Escape") setSelected(null);
      else if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        e.preventDefault();
        deleteSelected();
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
      forgetWall();
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
      forgetWall();
      setWall(w);
      setHolds([]);
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
            {selected && (
              <button className="danger" onClick={deleteSelected}>
                🗑 Delete hold
              </button>
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
            {holds.length} hold{holds.length === 1 ? "" : "s"} traced. Draw
            around a hold — letting go closes the outline. Click a traced hold
            to select it; Backspace deletes the selected hold.
          </p>
          <div className="wall-scroll">
            <div className="wall-canvas" style={{ width: `${ZOOMS[zoom] * 100}%` }}>
              <img src={wall.imageUrl} alt="Spray wall" draggable={false} />
              <svg
                ref={svgRef}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
              >
                {holds.map((h) => (
                  <polygon
                    key={h.id}
                    data-id={h.id}
                    points={toPoints(h.points)}
                    className={`hold-shape ${h.id === selected ? "selected" : ""}`}
                  />
                ))}
              </svg>
              {draft.length > 1 && (
                // Drawn in pixels while the stroke is live; stored as 0..1 on release
                <svg className="hold-draft-layer">
                  <polyline points={toPoints(draft)} className="hold-draft" />
                </svg>
              )}
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
