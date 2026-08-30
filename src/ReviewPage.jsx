import React, { useEffect, useRef, useState } from "react";
import { api, fmtTime } from "./api.js";
import DrawingCanvas from "./DrawingCanvas.jsx";

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff"];
const FRAME = 1 / 30;

export default function ReviewPage({ videoId, role, onBack }) {
  const videoRef = useRef(null);
  const canvasApi = useRef(null);
  const [video, setVideo] = useState(null);
  const [comments, setComments] = useState([]);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  // Drawing state (coach)
  const [drawMode, setDrawMode] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [brush, setBrush] = useState(6);
  const [strokes, setStrokes] = useState([]); // strokes being authored
  const [hold, setHold] = useState(2); // seconds the drawing stays visible during playback

  // A saved drawing being viewed (from a clicked comment)
  const [viewedComment, setViewedComment] = useState(null);
  const [commentText, setCommentText] = useState("");

  useEffect(() => {
    api.getVideo(videoId).then(setVideo);
    refreshComments();
  }, [videoId]);

  const refreshComments = () => api.listComments(videoId).then(setComments);

  // timeupdate only fires ~4x/sec — too coarse for frame-length overlay holds,
  // so poll currentTime with rAF while playing
  useEffect(() => {
    if (!playing) return;
    let raf;
    const tick = () => {
      if (videoRef.current) setTime(videoRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // --- playback helpers ---
  const v = () => videoRef.current;
  function togglePlay() {
    if (!v()) return;
    if (v().paused) {
      setViewedComment(null);
      setDrawMode(false);
      v().play();
    } else v().pause();
  }
  function seek(t) {
    v().currentTime = Math.min(Math.max(t, 0), duration || 0);
  }
  function step(frames) {
    v().pause();
    seek(v().currentTime + frames * FRAME);
  }

  function enterDrawMode() {
    v().pause();
    setViewedComment(null);
    setDrawMode(true);
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!commentText.trim() && strokes.length === 0) return;
    await api.addComment(videoId, {
      time: v().currentTime,
      text: commentText.trim(),
      author: role === "coach" ? "Coach" : video?.student || "Student",
      drawing: strokes.length ? { strokes, duration: hold } : null,
    });
    setCommentText("");
    setStrokes([]);
    setDrawMode(false);
    refreshComments();
  }

  function openComment(c) {
    v().pause();
    setDrawMode(false);
    setStrokes([]);
    seek(c.time);
    setViewedComment(c);
  }

  async function removeComment(id) {
    await api.deleteComment(id);
    if (viewedComment?.id === id) setViewedComment(null);
    refreshComments();
  }

  // strokes shown on the canvas: authored strokes in draw mode; while playing,
  // every drawing whose hold window contains the playhead; else the clicked comment's
  const shownStrokes = drawMode
    ? strokes
    : playing
      ? comments
          .filter(
            (c) =>
              c.drawing &&
              time >= c.time &&
              time <= c.time + (c.drawing.duration ?? 2)
          )
          .flatMap((c) => c.drawing.strokes)
      : viewedComment?.drawing?.strokes || [];

  if (!video) return <main className="review">Loading…</main>;

  return (
    <main className="review">
      <button className="back" onClick={onBack}>← Back to dashboard</button>
      <div className="review-layout">
        <section className="player-col">
          <h2>{video.title}</h2>
          <p className="muted">
            {video.student}
            {video.notes ? ` — "${video.notes}"` : ""}
          </p>

          <div className="stage">
            <video
              ref={videoRef}
              src={video.url}
              playsInline
              onClick={() => !drawMode && togglePlay()}
              onTimeUpdate={(e) => setTime(e.target.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.target.duration)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            <DrawingCanvas
              ref={canvasApi}
              active={drawMode}
              color={color}
              size={brush}
              strokes={shownStrokes}
              onStrokesChange={setStrokes}
            />
          </div>

          {/* timeline with comment markers */}
          <div
            className="timeline"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const scrub = (ev) =>
                seek(((ev.clientX - rect.left) / rect.width) * duration);
              scrub(e);
              const move = (ev) => scrub(ev);
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          >
            <div
              className="timeline-fill"
              style={{ width: duration ? `${(time / duration) * 100}%` : 0 }}
            />
            {comments
              .filter((c) => c.drawing && duration)
              .map((c) => (
                <div
                  key={`span-${c.id}`}
                  className="hold-span"
                  style={{
                    left: `${(c.time / duration) * 100}%`,
                    width: `${(Math.min(c.drawing.duration ?? 2, duration - c.time) / duration) * 100}%`,
                  }}
                />
              ))}
            {drawMode && duration > 0 && (
              <div
                className="pending-span"
                style={{
                  left: `${(time / duration) * 100}%`,
                  width: `${(Math.min(hold, duration - time) / duration) * 100}%`,
                }}
              >
                <div
                  className="pending-handle"
                  title="Drag to set how long the drawing stays visible"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget
                      .closest(".timeline")
                      .getBoundingClientRect();
                    const start = time;
                    const move = (ev) => {
                      const t =
                        ((ev.clientX - rect.left) / rect.width) * duration;
                      setHold(
                        Math.max(FRAME, Math.min(t, duration) - start)
                      );
                    };
                    const up = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", up);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", up);
                  }}
                />
                <span className="pending-label">
                  until {fmtTime(Math.min(time + hold, duration))}
                </span>
              </div>
            )}
            {comments.map((c) => (
              <div
                key={c.id}
                title={`${fmtTime(c.time)} ${c.text}`}
                className={`marker ${c.drawing ? "has-drawing" : ""}`}
                style={{ left: duration ? `${(c.time / duration) * 100}%` : 0 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  openComment(c);
                }}
              />
            ))}
          </div>

          <div className="controls">
            <button onClick={() => step(-1)} title="Back one frame">⏮︎</button>
            <button className="play" onClick={togglePlay}>
              {playing ? "❚❚" : "▶"}
            </button>
            <button onClick={() => step(1)} title="Forward one frame">⏭︎</button>
            <span className="clock">
              {fmtTime(time)} / {fmtTime(duration)}
            </span>
            <select
              value={rate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                v().playbackRate = r;
              }}
            >
              {[0.25, 0.5, 1, 1.5, 2].map((r) => (
                <option key={r} value={r}>{r}×</option>
              ))}
            </select>
            {role === "coach" && !drawMode && (
              <button className="draw-toggle" onClick={enterDrawMode}>
                ✏️ Draw
              </button>
            )}
          </div>

        </section>

        <aside className="comments-col">
          <h3>Feedback</h3>
          <form className="comment-form" onSubmit={submitComment}>
            <div className="muted">
              At {fmtTime(time)}
              {strokes.length > 0 && ` · ${strokes.length} stroke drawing attached`}
            </div>
            <textarea
              rows={3}
              value={commentText}
              placeholder={
                drawMode
                  ? "Optional notes to go with your drawing…"
                  : role === "coach"
                  ? "Leave feedback at this timestamp…"
                  : "Reply / ask a question at this timestamp…"
              }
              onChange={(e) => setCommentText(e.target.value)}
            />
            <button
              type="submit"
              className={`post-btn ${drawMode ? "drawing" : ""}`}
            >
              {drawMode ? "✓ Submit drawing + notes" : "Post comment"}
            </button>
          </form>

          {drawMode && (
            <div className="draw-toolbar">
              <div className="draw-toolbar-head">
                <strong>Drawing tools</strong>
                <button
                  className="exit-draw"
                  onClick={() => {
                    setStrokes([]);
                    setDrawMode(false);
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
              <div className="draw-row">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`swatch ${c === color ? "selected" : ""}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <label className="draw-row">
                Brush
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                />
              </label>
              <label className="draw-row hold-label">
                Hold
                <input
                  type="range"
                  min={0.1}
                  max={8}
                  step={0.1}
                  value={hold}
                  onChange={(e) => setHold(Number(e.target.value))}
                />
                <span className="hold-readout">
                  {hold.toFixed(1)}s ({Math.round(hold / FRAME)}f)
                </span>
              </label>
              <div className="draw-row">
                <button onClick={() => canvasApi.current.undo()}>Undo</button>
                <button onClick={() => canvasApi.current.clear()}>Clear</button>
              </div>
              <p className="muted">
                Draw on the video, then hit “Submit drawing + notes” above to
                post it.
              </p>
            </div>
          )}

          <div className="comment-list">
            {comments.length === 0 && (
              <p className="muted">No feedback yet.</p>
            )}
            {comments.map((c) => (
              <div
                key={c.id}
                className={`comment ${viewedComment?.id === c.id ? "selected" : ""}`}
                onClick={() => openComment(c)}
              >
                <div className="comment-head">
                  <span className="timestamp">{fmtTime(c.time)}</span>
                  <strong>{c.author}</strong>
                  {c.drawing && <span title="Has drawing">🎨</span>}
                  {role === "coach" && (
                    <button
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeComment(c.id);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {c.text && <p>{c.text}</p>}
              </div>
            ))}
          </div>

          {role === "coach" && (
            <button
              className="done-btn"
              onClick={() =>
                api.setStatus(videoId, "reviewed").then(setVideo)
              }
              disabled={video.status === "reviewed"}
            >
              {video.status === "reviewed"
                ? "✓ Marked as reviewed"
                : "Mark review complete"}
            </button>
          )}
        </aside>
      </div>
    </main>
  );
}
