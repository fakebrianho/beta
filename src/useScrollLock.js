import { useEffect } from "react";

// iOS Safari ignores `overflow: hidden` on <body>, so pin the body at its
// current offset instead and restore the position on close. Without this the
// page behind an open modal keeps scrolling under your finger, which makes it
// hard to reach the bottom of a tall modal.
export default function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const y = window.scrollY;
    const { body } = document;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";
    return () => {
      Object.assign(body.style, prev);
      window.scrollTo(0, y); // put them back where they were
    };
  }, [active]);
}
