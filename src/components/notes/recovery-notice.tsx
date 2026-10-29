"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "@/components/sodium/ui/toast";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";
import { getDB, type RecoveryRecord } from "@/lib/local-db";
import { deleteRecovery } from "@/lib/collab/store";

const REASONS: Record<RecoveryRecord["reason"], string> = {
  other_window: "Unsent changes from another window",
  older_window: "Typed in an older open window",
  unmerged: "Changes Monotes couldn’t merge automatically",
  deleted: "Unsent when the note was deleted",
  before_connect: "This device’s copy before connecting",
  unsaved_typing: "Typing from before a reload",
  unsent: "Changes Monotes couldn’t send",
};

/* Text Monotes kept instead of merging or discarding it. */
export default function RecoveryNotice({
  noteId,
  onAppend,
}: {
  noteId: string;
  onAppend: ((text: string) => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const recoveries = useLiveQuery(
    () => getDB().recoveries.where("noteId").equals(noteId).reverse().sortBy("createdAt"),
    [noteId],
  );
  if (!recoveries?.length) return null;
  return (
    <>
      <Alert className="mb-4">
        <AlertTitle>Kept text</AlertTitle>
        <AlertDescription>
          Monotes kept {recoveries.length === 1 ? "some text" : `${recoveries.length} pieces of text`} it didn’t merge
          into this note.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Review kept text
          </Button>
        </AlertAction>
      </Alert>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Kept text</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              This text is stored only on this device. Copy what you need, add it to the note, or discard it.
            </DialogDescription>
            <ul className="mt-2">
              {recoveries.map((recovery) => (
                <li key={recovery.id} className="rule-row flex flex-col gap-2 py-3">
                  <div className="type-label-sm text-text-2">
                    {REASONS[recovery.reason]} · {new Date(recovery.createdAt).toLocaleString()}
                  </div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap bg-code-surface p-2 type-code-sm text-text-1">
                    {recovery.text}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        navigator.clipboard.writeText(recovery.text).then(
                          () => toast.success("Copied"),
                          () => toast.fail("Couldn’t copy"),
                        )
                      }
                    >
                      Copy
                    </Button>
                    {onAppend && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          onAppend(recovery.text);
                          if (recovery.id !== undefined) await deleteRecovery(recovery.id);
                        }}
                      >
                        Add to end of note
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (recovery.id !== undefined) await deleteRecovery(recovery.id);
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </DialogBody>
          <DialogFooter defaultAction="none">
            <DialogClose>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
