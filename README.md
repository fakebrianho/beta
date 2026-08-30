# Beta Coach 🧗

Climbing coaching app: students upload short videos, the coach scrubs through
them, leaves timestamped comments, and draws Excalidraw-style annotations on
frames.

## Run it

```sh
npm install
npm run dev
```

Opens the Vite frontend on http://localhost:5173 and the Express API on :4000
(proxied, so just use 5173).

## How it works right now (deliberately simple)

- **No real auth yet** — a Student/Coach toggle in the header swaps the UI.
- **Storage is all local & free**: videos go to `server/uploads/`, metadata and
  comments to `server/data/db.json` (both gitignored).
- **Comments** are timestamped; clicking one seeks the player and shows any
  attached drawing. Timeline markers: yellow = text, red = has drawing.
- **Drawings** are stored as normalized (0–1) stroke coordinates in the comment
  JSON, so they replay correctly at any player size. Coach hits ✏️ Draw
  (pauses the video), sketches, then posts — the drawing attaches to the
  comment at that timestamp.
- Player extras: click-to-play, drag scrubbing, frame step (1/30s), 0.25–2×
  playback speed.

## Later (when you outgrow local)

- Swap `server/` for Supabase (free tier: auth + Postgres + storage) — the
  `src/api.js` module is the only file that talks to the backend.
- Real accounts: keep the same `role` concept, derive it from the logged-in user.
- Video compression on upload (client-side via ffmpeg.wasm) to stay in free
  storage limits.
