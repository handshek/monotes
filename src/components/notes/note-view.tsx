"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getDB } from "@/lib/local-db";
import { hydrateCloudNote, markConnected } from "@/lib/collab/store";
import NotesEditor from "./notes-editor";
import CollabNoteEditor from "./collab-note-editor";

/*
 * Choose how to open a note. Ordinary scratch notes keep the local editor.
 * Notes connected for agents use the collaborative editor, which watches
 * the note itself, so nothing here stays subscribed to them. A note that is
 * only in the cloud is copied to this device, and a note connected on
 * another device switches over without losing local text. Only metadata is
 * watched; the text is fetched once when it is needed.
 */
export default function NoteView({ noteId }: { noteId: string }) {
  const convex = useConvex();
  const row = useLiveQuery(async () => (await getDB().notes.get(noteId)) ?? null, [noteId]);
  const { isAuthenticated } = useConvexAuth();
  const watch = isAuthenticated && row !== undefined && !row?.collab;
  const info = useQuery(api.collab.openInfo, watch ? { noteId } : "skip");
  const needsCopy = info?.status === "ok" && (row === null || (info.epoch !== null && !row?.collab));
  const [copyFailed, setCopyFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needsCopy) return;
    let cancelled = false;
    setCopyFailed(false);
    void (async () => {
      const cloud = await convex.query(api.collab.openContent, { noteId });
      if (!cloud) throw new Error("The cloud copy isn't available");
      if (cloud.epoch) await markConnected(noteId, cloud.epoch, cloud.content, cloud.updatedAt);
      else await hydrateCloudNote(noteId, cloud.content, cloud.updatedAt);
    })().catch(() => {
      // Nothing was written. Show the failure rather than an empty note;
      // an existing local copy stays open in the meantime.
      if (!cancelled) setCopyFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needsCopy, convex, noteId, attempt]);

  if (row === undefined) return null;
  if (row?.collab) {
    return (
      <CollabNoteEditor
        key={row.collab.epoch}
        noteId={noteId}
        epoch={row.collab.epoch}
        lastEdited={row.updatedAt}
        fallbackText={row.content}
      />
    );
  }
  if (row === null && isAuthenticated && (info === undefined || needsCopy)) {
    if (copyFailed) {
      return (
        <div role="alert" className="py-12 text-center text-sm">
          Monotes couldn’t open this note from your cloud account.{" "}
          <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <p role="status" className="py-12 text-center text-sm text-muted-foreground">
        Opening…
      </p>
    );
  }
  return <NotesEditor noteId={noteId} />;
}
