import React, { useState } from "react";

// Video is ~98% of our storage and transfer budget, so don't fetch a single
// byte until someone actually asks to watch. Browsers pull far more than the
// name suggests for preload="metadata", especially on .mov files.
export default function LazyVideo({ src, poster, className = "" }) {
  const [play, setPlay] = useState(false);

  if (play)
    return (
      <video
        className={className}
        src={src}
        poster={poster}
        controls
        autoPlay
        playsInline
        preload="auto"
      />
    );

  return (
    <button
      type="button"
      className={`lazy-video ${className}`}
      onClick={() => setPlay(true)}
      style={poster ? { backgroundImage: `url(${poster})` } : undefined}
      title="Load and play"
    >
      <span className="lazy-video-play">▶</span>
    </button>
  );
}
