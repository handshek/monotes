import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getNote, saveNote } from "@/lib/local-notes";
import type { NoteContent } from "@/lib/local-db";
import {
  clearPendingDraft,
  compareNoteRevisions,
  createDraft,
  readPendingDraft,
  writePendingDraft,
  type NoteDraft,
} from "@/lib/local-drafts";

const SAVE_ERROR = "Changes aren’t saved to this device. Keep this tab open and try saving again.";

export function useLocalNote(slug: string) {
  const observed = useLiveQuery(async () => {
    try {
      return { slug, note: await getNote(slug), error: null };
    } catch {
      return { slug, error: "Couldn’t load this note. Reload to try again." };
    }
  }, [slug]);
  const [optimistic, setOptimistic] = useState<NoteContent | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingRef = useRef<NoteDraft | null>(null);
  const activeSlugRef = useRef<string | null>(slug);
  const recoveredSlugRef = useRef<string | null>(null);
  const currentNoteRef = useRef<NoteContent | null | undefined>(undefined);
  const stored = observed?.slug === slug ? observed.note : undefined;
  const loadError = observed?.slug === slug ? observed.error : null;
  const note = stored === null
    ? null
    : optimistic?.id === slug && (!stored || compareNoteRevisions(optimistic, stored) > 0)
      ? optimistic
      : stored;
  currentNoteRef.current = note;

  useEffect(() => {
    activeSlugRef.current = slug;
    return () => { activeSlugRef.current = null; };
  }, [slug]);

  const persist = useCallback(async (draft: NoteDraft) => {
    try {
      const saved = await saveNote(draft);
      clearPendingDraft(draft);
      const pending = pendingRef.current;
      const settled = pending?.id === draft.id && (!saved || compareNoteRevisions(saved, pending) >= 0);
      if (settled) {
        clearPendingDraft(pending);
        pendingRef.current = null;
      }
      if (activeSlugRef.current !== draft.id) return saved;
      if (settled) {
        currentNoteRef.current = saved;
        setOptimistic(saved);
        setIsSaving(false);
        setSaveError(null);
      }
      return saved;
    } catch (error) {
      const pending = pendingRef.current;
      if (activeSlugRef.current === draft.id && pending && compareNoteRevisions(pending, draft) === 0) {
        setIsSaving(false);
        setSaveError(SAVE_ERROR);
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    if (stored === undefined || recoveredSlugRef.current === slug) return;
    recoveredSlugRef.current = slug;
    const recovered = readPendingDraft(slug);
    if (!recovered) return;
    if (!stored || compareNoteRevisions(stored, recovered) >= 0) {
      clearPendingDraft(recovered);
      return;
    }
    const pending = pendingRef.current;
    if (pending?.id === slug && compareNoteRevisions(pending, recovered) >= 0) return;
    pendingRef.current = recovered;
    const restored = { ...stored, ...recovered };
    currentNoteRef.current = restored;
    setOptimistic(restored);
    setIsSaving(true);
    void persist(recovered).catch(() => {});
  }, [slug, stored, persist]);

  useEffect(() => {
    if (stored === undefined) return;
    const pending = pendingRef.current;
    if (pending?.id === slug && (!stored || compareNoteRevisions(stored, pending) >= 0)) {
      clearPendingDraft(pending);
      pendingRef.current = null;
      setIsSaving(false);
      setSaveError(null);
    }
    if (!stored) setOptimistic(null);
  }, [slug, stored]);

  const setMarkdown = useCallback((content: string) => {
    const current = currentNoteRef.current;
    if (!current || current.id !== slug || current.content === content) return;
    const draft = createDraft(current, content);
    const next = { ...current, ...draft };
    pendingRef.current = draft;
    currentNoteRef.current = next;
    setOptimistic(next);
    setIsSaving(true);
    setSaveError(null);
    writePendingDraft(draft);
    void persist(draft).catch(() => {});
  }, [slug, persist]);

  const saveNow = useCallback(async () => {
    if (currentNoteRef.current?.id !== slug) throw new Error("Note is unavailable");
    let pending = pendingRef.current;
    while (pending?.id === slug) {
      setIsSaving(true);
      const saved = await persist(pending);
      if (!saved) throw new Error("This note was deleted");
      pending = pendingRef.current;
    }
  }, [slug, persist]);

  return {
    note,
    isLoading: note === undefined && !loadError,
    isSaving,
    saveError,
    loadError,
    setMarkdown,
    saveNow,
  };
}
