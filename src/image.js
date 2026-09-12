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

export async function toDisplayableImage(file) {
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
