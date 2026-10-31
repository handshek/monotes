import { useEffect, useMemo, useSyncExternalStore } from "react";
import { NoteSession } from "@/lib/note-session";

export function useLocalNote(slug: string) {
  const session = useMemo(() => new NoteSession(slug), [slug]);
  useEffect(() => session.open(), [session]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { ...snapshot, setMarkdown: session.setMarkdown, saveNow: session.saveNow };
}
