"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getDB } from "@/lib/local-db";
import { hydrateCloudNote, markConnected } from "@/lib/collab/store";
import { noteTitle } from "@/lib/note-summary";
import NotesEditor from "./notes-editor";
import CollabNoteEditor from "./collab-note-editor";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";

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
  const tabTitle = row ? `${noteTitle(row.content)} · Monotes` : null;

  // The tab and browser history name the note; leaving it restores the app's name.
  useEffect(() => {
    if (!tabTitle) return;
    document.title = tabTitle;
  }, [tabTitle]);
  useEffect(() => () => {
    document.title = "Monotes";
  }, []);

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
        <div className="py-12">
          <Alert status="fail">
            <AlertTitle>Cloud copy</AlertTitle>
            <AlertDescription>Monotes couldn’t open this note from your cloud account.</AlertDescription>
            <AlertAction>
              <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </Button>
            </AlertAction>
          </Alert>
        </div>
      );
    }
    return (
      <p role="status" className="py-12 text-center type-body-sm text-text-2">
        Opening…
      </p>
    );
  }
  return <NotesEditor noteId={noteId} />;
}
