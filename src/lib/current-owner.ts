import { useSyncExternalStore } from "react";
import { LOCAL_OWNER } from "@/lib/local-db";

const OWNER_KEY = "monotes-owner";
const listeners = new Set<() => void>();
// Used if this browser refuses local storage, and shared by every tab otherwise.
let remembered: string = LOCAL_OWNER;

/*
 * The owner whose space this device is showing. It lives in device storage so
 * it is known before auth settles, and it changes only on a confirmed sign-in
 * or an explicit sign-out. An offline, lapsed or loading session keeps it.
 */
export function readCurrentOwner(): string {
  try {
    return localStorage.getItem(OWNER_KEY) ?? remembered;
  } catch {
    return remembered;
  }
}

export function setCurrentOwner(owner: string) {
  remembered = owner;
  try {
    localStorage.setItem(OWNER_KEY, owner);
  } catch {
    // This tab still changes owner through `remembered`.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/* Null until the browser can answer, so no list renders for the wrong owner. */
export function useCurrentOwner(): string | null {
  return useSyncExternalStore(subscribe, readCurrentOwner, () => null);
}
