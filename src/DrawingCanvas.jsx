import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

// Canvas overlay sized to the video. Strokes use normalized 0..1 coordinates
// so they replay correctly at any player size.
const DrawingCanvas = forwardRef(function DrawingCanvas(
  { active, color, size, strokes, onStrokesChange },
  ref
) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const currentStroke = useRef(null);

  useImperativeHandle(ref, () => ({
    undo: () => onStrokesChange(strokes.slice(0, -1)),
    clear: () => onStrokesChange([]),
  }));

  // Keep canvas resolution matched to its displayed size
  useEffect(() => {
    const canvas = canvasRef.current;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      redraw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  useEffect(redraw, [strokes]);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s, canvas);
  }

  function drawStroke(ctx, stroke, canvas) {
    if (stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size * (canvas.width / 1000);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      const x = p.x * canvas.width;
      const y = p.y * canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function onPointerDown(e) {
    if (!active) return;
    e.target.setPointerCapture(e.pointerId);
    currentStroke.current = { color, size, points: [pos(e)] };
    setDrawing(true);
  }

  function onPointerMove(e) {
    if (!drawing || !currentStroke.current) return;
    currentStroke.current.points.push(pos(e));
    // live preview: draw incrementally
    const canvas = canvasRef.current;
    drawStroke(canvas.getContext("2d"), currentStroke.current, canvas);
  }

  function onPointerUp() {
    if (!drawing) return;
    setDrawing(false);
    if (currentStroke.current?.points.length > 1)
      onStrokesChange([...strokes, currentStroke.current]);
    currentStroke.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`draw-canvas ${active ? "active" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
});

export default DrawingCanvas;
