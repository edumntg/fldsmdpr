import { useState } from "react";

/**
 * Drag-resizable pane size, persisted per key in localStorage.
 * `start(e, axis, sign)`: axis is which mouse coordinate to track; sign is +1
 * when dragging along the axis grows the pane, -1 when it shrinks it (e.g. a
 * bottom drawer grows as the handle moves up).
 */
export function usePaneSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    const saved = Number(localStorage.getItem(`pane:${key}`));
    return saved >= min && saved <= max ? saved : initial;
  });

  const start = (e: React.MouseEvent, axis: "x" | "y", sign: 1 | -1) => {
    e.preventDefault();
    const origin = axis === "x" ? e.clientX : e.clientY;
    const base = size;
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    const move = (ev: MouseEvent) => {
      const cur = axis === "x" ? ev.clientX : ev.clientY;
      const next = Math.min(max, Math.max(min, base + sign * (cur - origin)));
      setSize(next);
      localStorage.setItem(`pane:${key}`, String(next));
    };
    const up = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return [size, start] as const;
}
