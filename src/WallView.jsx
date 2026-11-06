import React, { useEffect, useId, useState } from "react";
import { api } from "./api.js";

export const ROLES = ["start", "hand", "foot", "finish"];

// A route needs 1–2 start holds and 1–2 finish holds; returns what's wrong, if anything
export function holdProblem(holds) {
  const roles = Object.values(holds || {});
  const count = (r) => roles.filter((x) => x === r).length;
  if (count("start") < 1) return "Mark at least one start hold.";
  if (count("start") > 2) return "A route can have at most two start holds.";
  if (count("finish") < 1) return "Mark at least one finish hold.";
  if (count("finish") > 2) return "A route can have at most two finish holds.";
  return null;
}
export const ROLE_COLORS = {
  start: "#22c55e",
  hand: "#3b82f6",
  foot: "#eab308",
  finish: "#a855f7",
};

// The wall rarely changes, so every view shares one fetch
let wallPromise = null;
export const forgetWall = () => {
  wallPromise = null;
};
export function useWall() {
  const [wall, setWall] = useState(null);
  useEffect(() => {
    wallPromise ||= api.getWall().catch(() => {
      wallPromise = null;
      return null;
    });
    let live = true;
    wallPromise.then((w) => live && setWall(w));
    return () => {
      live = false;
    };
  }, []);
  return wall;
}

// Natural photo size: it becomes the SVG's coordinate space, so the photo and
// the hold outlines scale, crop and letterbox together
const sizes = new Map();
function useImageSize(url) {
  const [size, setSize] = useState(() => sizes.get(url) || null);
  useEffect(() => {
    if (!url) return;
    if (sizes.has(url)) return setSize(sizes.get(url));
    const img = new Image();
    img.onload = () => {
      const s = [img.naturalWidth, img.naturalHeight];
      sizes.set(url, s);
      setSize(s);
    };
    img.src = url;
  }, [url]);
  return size;
}

// Shoelace area of a hold's outline (0..1 units — only used for ordering)
const area = (pts) =>
  Math.abs(
    pts.reduce((sum, [x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length];
      return sum + x * ny - nx * y;
    }, 0)
  ) / 2;

// Holds overlap when a small hold is bolted onto a big one. SVG gives taps to
// whatever is drawn last, so draw biggest first: a small hold then always sits
// on top of (and stays tappable over) the hold around it.
const areas = new WeakMap();
export const bySizeDesc = (holds) =>
  [...holds].sort((a, b) => {
    for (const h of [a, b]) if (!areas.has(h)) areas.set(h, area(h.points));
    return areas.get(b) - areas.get(a);
  });

// Route holds come from the API as [{ hold, role }]; views want { holdId: role }
export const holdMap = (holds) =>
  Object.fromEntries((holds || []).map((h) => [h.hold, h.role]));

// The wall photo with a route's holds outlined in their role colors.
//   crop:      zoom to the route's holds (cards, thumbnails)
//   dim:       darken everything but the route's holds
//   showAll:   faintly outline every traced hold (setting)
//   onTapHold: make holds tappable; called with (hold, event)
export default function WallView({
  wall,
  holds = {},
  crop,
  dim,
  showAll,
  onTapHold,
  className = "",
}) {
  const size = useImageSize(wall?.imageUrl);
  const maskId = "dim" + useId().replace(/:/g, "");
  if (!wall || !size) return <div className={`wall-view loading ${className}`} />;

  const [W, H] = size;
  const scaled = (pts) => pts.map(([x, y]) => `${x * W},${y * H}`).join(" ");
  const used = wall.holds.filter((h) => holds[h.id]);

  let viewBox = `0 0 ${W} ${H}`;
  if (crop && used.length) {
    const pts = used.flatMap((h) => h.points);
    const xs = pts.map((p) => p[0] * W);
    const ys = pts.map((p) => p[1] * H);
    const pad = 0.04 * Math.max(W, H);
    const x0 = Math.max(0, Math.min(...xs) - pad);
    const y0 = Math.max(0, Math.min(...ys) - pad);
    const x1 = Math.min(W, Math.max(...xs) + pad);
    const y1 = Math.min(H, Math.max(...ys) + pad);
    viewBox = `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;
  }

  return (
    <svg
      className={`wall-view ${className}`}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      <image href={wall.imageUrl} width={W} height={H} />
      {dim && used.length > 0 && (
        <>
          <mask id={maskId}>
            <rect width={W} height={H} fill="white" />
            {used.map((h) => (
              <polygon key={h.id} points={scaled(h.points)} fill="black" />
            ))}
          </mask>
          <rect
            width={W}
            height={H}
            fill="rgba(0, 0, 0, 0.55)"
            mask={`url(#${maskId})`}
          />
        </>
      )}
      {bySizeDesc(wall.holds).map((h) => {
        const role = holds[h.id];
        if (!role && !showAll && !onTapHold) return null;
        const points = scaled(h.points);
        const tap = onTapHold && ((e) => onTapHold(h, e));
        return role ? (
          <g key={h.id} className="wall-hold-role" onClick={tap}>
            <polygon points={points} className="wall-hold-halo" />
            <polygon points={points} stroke={ROLE_COLORS[role]} />
          </g>
        ) : (
          <polygon
            key={h.id}
            points={points}
            className={`wall-hold ${showAll ? "faint" : ""}`}
            onClick={tap}
          />
        );
      })}
    </svg>
  );
}

// A route's picture: its spot on the wall if it was set there, else its photo
export function RouteImage({ route, wall, className = "", lazy }) {
  return route.holds?.length ? (
    <WallView
      wall={wall}
      holds={holdMap(route.holds)}
      crop
      dim
      className={className}
    />
  ) : (
    <img
      className={className}
      src={route.imageUrl}
      alt={route.title || ""}
      loading={lazy ? "lazy" : undefined}
    />
  );
}

export function RoleLegend({ holds }) {
  const counts = Object.values(holds || {}).reduce(
    (c, r) => ({ ...c, [r]: (c[r] || 0) + 1 }),
    {}
  );
  return (
    <div className="role-legend">
      {ROLES.map((r) => (
        <span key={r} className="role-legend-item">
          <span className="role-swatch" style={{ borderColor: ROLE_COLORS[r] }} />
          {r}
          {holds && ` ${counts[r] || 0}`}
        </span>
      ))}
    </div>
  );
}
