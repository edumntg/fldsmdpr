import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function relativeTime(unixMs: number): string {
  const diff = Date.now() - unixMs;
  // Future timestamps (calendar events) read as "in …", not "Just now".
  if (diff < -60_000) {
    const m = Math.round(-diff / 60_000);
    if (m < 60) return `in ${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `in ${h}h`;
    return `in ${Math.round(h / 24)}d`;
  }
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(unixMs).toLocaleDateString();
}

export const isMac = navigator.platform.toUpperCase().includes("MAC");
export const modKey = isMac ? "⌘" : "Ctrl";
