"use client";

import { useEffect, useState } from "react";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "3 min ago", "2 h ago", "yesterday", "Oct 29" or "Oct 29, 2025". */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;

  const then = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (timestamp >= startOfToday) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (timestamp >= startOfToday - DAY) return "yesterday";

  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(then.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** The full date and time, for a tooltip beside a relative time. */
export function formatExactTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A relative time that stays current while it is on screen. */
export function useRelativeTime(timestamp: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [timestamp]);
  return timestamp ? formatRelativeTime(timestamp, now) : null;
}
