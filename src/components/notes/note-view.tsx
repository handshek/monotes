"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getDB } from "@/lib/local-db";
import { hydrateCloudNote, markConnected } from "@/lib/collab/store";
import { getNote } from "@/lib/local-notes";
import { useCurrentOwner } from "@/lib/current-owner";
import { useUploadQueue } from "@/contexts/upload-queue-context";
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
  const owner = useCurrentOwner();
  const row = useLiveQuery(async () => (owner ? getNote(noteId) : undefined), [noteId, owner]);
  // Another owner's copy reads as missing, and nothing may write over it.
  const elsewhere = useLiveQuery(
    async () => row === null && !!(await getDB().notes.get(noteId)),
    [noteId, row],
  );
  const { isAuthenticated } = useConvexAuth();
  const watch = isAuthenticated && row !== undefined && !row?.collab;
  const info = useQuery(api.collab.openInfo, watch ? { noteId } : "skip");
  const needsCopy = info?.status === "ok" && elsewhere === false && (row === null || (info.epoch !== null && !row?.collab));
  const queue = useUploadQueue();
  const cloudGone = info?.status === "deleted";
  const cloudMoved = info?.status === "ok" && info.epoch === null ? info.revision : null;
  const synced = !!row && !row.collab && row.cloudStatus !== "local";
  const seenRevision = row?.cloudRevision;
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
      else await hydrateCloudNote(noteId, cloud.content, cloud.updatedAt, cloud.revision);
    })().catch(() => {
      // Nothing was written. Show the failure rather than an empty note;
      // an existing local copy stays open in the meantime.
      if (!cancelled) setCopyFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needsCopy, convex, noteId, attempt]);

  // Text comes only when the metadata says this device is behind.
  useEffect(() => {
    if (!synced) return;
    if (cloudGone) void queue.deletedInCloud(noteId);
    else if (cloudMoved !== null && (seenRevision === undefined || cloudMoved > seenRevision)) void queue.pull(noteId);
  }, [synced, cloudGone, cloudMoved, seenRevision, queue, noteId]);

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
  if (row === null && !elsewhere && isAuthenticated && (info === undefined || needsCopy)) {
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
  return <NotesEditor key={owner} noteId={noteId} />;
}
