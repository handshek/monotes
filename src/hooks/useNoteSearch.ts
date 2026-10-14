"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB, type NoteContent } from "@/lib/local-db";
import { useSearchCloudNotes } from "@/lib/cloud-notes";

export type NoteSearchResult = Pick<NoteContent, "id" | "content" | "updatedAt">;

export function useNoteSearch(searchQuery: string) {
  const trimmedQuery = searchQuery.trim();
  const [query, setQuery] = useState(trimmedQuery);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(trimmedQuery), 300);
    return () => window.clearTimeout(timer);
  }, [trimmedQuery]);

  const localNotes = useLiveQuery(
    () => getDB().notes.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const cloudNotes = useSearchCloudNotes(query || undefined);

  const notes = useMemo<NoteSearchResult[]>(() => {
    if (!query) return localNotes ?? [];

    const lowercaseQuery = query.toLowerCase();
    const matches = (localNotes ?? []).filter((note) =>
      note.content.toLowerCase().includes(lowercaseQuery),
    );
    const localIds = new Set(matches.map((note) => note.id));
    const cloudOnly = (cloudNotes ?? [])
      .filter((note) => !localIds.has(note.noteId))
      .map((note) => ({
        id: note.noteId,
        content: note.content,
        updatedAt: note.updatedAt,
      }));

    return [...matches, ...cloudOnly];
  }, [localNotes, cloudNotes, query]);

  return { notes, query, isLoading: localNotes === undefined };
}
