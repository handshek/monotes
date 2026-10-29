"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
      <div role="status" className="mb-4 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
        <span>
          Monotes kept {recoveries.length === 1 ? "some text" : `${recoveries.length} pieces of text`} it didn’t merge
          into this note.
        </span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Review kept text
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Kept text</DialogTitle>
            <DialogDescription>
              This text is stored only on this device. Copy what you need, add it to the note, or discard it.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-4">
            {recoveries.map((recovery) => (
              <li key={recovery.id} className="rounded-md border p-3">
                <div className="mb-2 text-xs text-muted-foreground">
                  {REASONS[recovery.reason]} · {new Date(recovery.createdAt).toLocaleString()}
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{recovery.text}</pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard.writeText(recovery.text).then(
                        () => toast.success("Copied"),
                        () => toast.error("Couldn’t copy"),
                      )
                    }
                  >
                    Copy
                  </Button>
                  {onAppend && (
                    <Button
                      size="sm"
                      variant="outline"
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
        </DialogContent>
      </Dialog>
    </>
  );
}
