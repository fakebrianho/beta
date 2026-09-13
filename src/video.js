// Phone clips land at ~77MB for 20 seconds (4K/1080p60, high bitrate), which
// blows through free-tier storage in a handful of sends. Re-encode in the
// browser to 720p30 at a modest bitrate — visually fine for reviewing beta,
// roughly 10-15x smaller. Also grabs a poster frame so route pages can show a
// thumbnail without downloading any video.
//
// This runs at playback speed and depends on MediaRecorder +
// canvas.captureStream(), so every failure path falls back to the original
// file rather than blocking the upload.

export const MAX_UPLOAD_MB = 50; // keep in step with MAX_UPLOAD_BYTES on the server

// Storage is the scarce resource, so oversized clips are refused — but say
// which problem it is, since "we couldn't compress it" needs a different fix
// from "your clip is too long".
export function tooBig(file, compressionFailed) {
  const mb = Math.round(file.size / 1048576);
  return new Error(
    compressionFailed
      ? `This browser couldn't shrink your video (${mb}MB, limit ${MAX_UPLOAD_MB}MB). Film a shorter clip, or record at a lower resolution — on iPhone: Settings → Camera → Record Video → 720p HD at 30 fps.`
      : `Still ${mb}MB after compressing (limit ${MAX_UPLOAD_MB}MB). Try a shorter clip — 30 seconds is plenty for a send.`
  );
}

const MAX_DIM = 1280; // 720p on the long edge
const BITRATE = 2_000_000; // ~2 Mbps
const FPS = 30;

const supported = () =>
  typeof MediaRecorder !== "undefined" &&
  typeof HTMLCanvasElement.prototype.captureStream === "function";

// Pick a container/codec this browser will actually record
function pickMime() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E", // Safari
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true; // required for programmatic play
    v.playsInline = true;
    v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("Can't read this video"));
  });
}

function fitted(v) {
  const scale = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight));
  // even dimensions keep H.264 encoders happy
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { w: even(v.videoWidth), h: even(v.videoHeight) };
}

// A JPEG of the first visible frame, used as a video poster
export async function posterFrom(file) {
  try {
    const v = await loadVideo(file);
    await new Promise((res) => {
      v.onseeked = res;
      v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
    });
    const { w, h } = fitted(v);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(v, 0, 0, w, h);
    URL.revokeObjectURL(v.src);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.7));
    return blob
      ? new File([blob], "poster.jpg", { type: "image/jpeg" })
      : null;
  } catch {
    return null;
  }
}

// Returns a smaller file, or the original if we can't do better
export async function compressVideo(file, onProgress) {
  if (!supported()) return file;
  const mime = pickMime();
  if (!mime) return file;

  let v;
  try {
    v = await loadVideo(file);
  } catch {
    return file;
  }

  try {
    const { w, h } = fitted(v);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    const stream = canvas.captureStream(FPS);
    // Muting only silences playback, not the captured track, so we can still
    // carry the original audio across where the browser exposes it
    try {
      const src = v.captureStream?.() || v.mozCaptureStream?.();
      const audio = src?.getAudioTracks?.()[0];
      if (audio) stream.addTrack(audio);
    } catch {
      /* video-only is fine */
    }
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: BITRATE,
      audioBitsPerSecond: 64_000,
    });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const done = new Promise((resolve, reject) => {
      rec.onstop = resolve;
      rec.onerror = reject;
    });

    rec.start(1000);
    await v.play();

    // Pump frames until the source ends
    await new Promise((resolve, reject) => {
      let raf;
      const draw = () => {
        if (v.ended || v.paused) return resolve();
        ctx.drawImage(v, 0, 0, w, h);
        if (v.duration) onProgress?.(v.currentTime / v.duration);
        raf = requestAnimationFrame(draw);
      };
      v.onended = () => {
        cancelAnimationFrame(raf);
        resolve();
      };
      v.onerror = () => reject(new Error("playback failed"));
      draw();
    });

    rec.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());

    const out = new Blob(chunks, { type: mime });
    // Only take the re-encode if it actually helped
    if (!out.size || out.size >= file.size) return file;
    const ext = mime.startsWith("video/mp4") ? ".mp4" : ".webm";
    return new File([out], file.name.replace(/\.[^.]+$/, "") + ext, {
      type: mime.split(";")[0],
    });
  } catch {
    return file; // any hiccup: upload what they picked
  } finally {
    URL.revokeObjectURL(v.src);
  }
}
