"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "@/components/sodium/ui/toast";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
import { Button } from "@/components/sodium/ui/button";
import LineDiffView from "./line-diff-view";
import type { SendProblem } from "@/lib/collab/session";

type Activity = FunctionReturnType<typeof api.collab.activity>[number];

/* Whether this tab's changes are all on the server, so a restore can be judged. */
export type RestoreReadiness = { ok: true } | { ok: false; reason: SendProblem | "unsent" };

const RESTORE_BLOCKED: Record<SendProblem | "unsent", string> = {
  unsent: "This tab still has changes to send. Connect to the internet and try again.",
  note_too_long: "This note is over 200,000 characters on this device. Shorten it, then restore.",
  too_large: "A change in this tab is too large to send. Start again from the shared note, then restore.",
  queue_too_large: "This tab’s recent changes are too large to send. Start again from the shared note, then restore.",
  rejected: "Monotes couldn’t send this tab’s recent changes. Try sending again, then restore.",
};
type Checkpoint = FunctionReturnType<typeof api.collab.checkpoints>[number];

const CHECKPOINT_LABELS: Record<Checkpoint["reason"], string> = {
  enabled: "When agent access started",
  periodic: "Saved version",
  before_agent_edit: "Before an agent edit",
  before_restore: "Before a restore",
  unchosen_copy: "The copy not chosen when connecting",
  late_overlap_draft: "Your offline edits before they were merged",
};

function when(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function describe(item: Activity) {
  switch (item.kind) {
    case "agent_edit":
      return `${item.agentName ?? "An agent"} edited this note`;
    case "restore":
      return "A saved version was restored";
    case "late_overlap":
      return "Offline edits landed in text an agent had changed";
    default:
      return "Agent access started";
  }
}

function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.fail("Couldn’t copy"),
  );
}

function ActivityComparison({ noteId, item }: { noteId: string; item: Activity }) {
  const checkpoint = useQuery(
    api.collab.checkpointText,
    item.checkpointId ? { noteId, checkpointId: item.checkpointId } : "skip",
  );
  const after = useQuery(api.collab.versionText, { noteId, version: item.toVersion });
  if (!item.checkpointId) return null;
  if (checkpoint === undefined || after === undefined) return <p role="status" className="mt-2 type-body-sm text-text-2">Loading…</p>;
  if (!checkpoint || !after) return <p className="mt-2 type-body-sm text-text-2">This comparison isn’t available.</p>;
  if (item.kind === "late_overlap") {
    return (
      <div className="mt-2 flex flex-col items-start gap-2">
        <p className="type-body-sm text-text-2">Merged result compared with what you typed offline:</p>
        <LineDiffView before={after.text} after={checkpoint.text} label="Merged text compared with your offline text" />
        <Button size="sm" variant="secondary" onClick={() => copy(checkpoint.text)}>Copy your offline text</Button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col items-start gap-2">
      <p className="type-body-sm text-text-2">Before compared with right after this change:</p>
      <LineDiffView before={checkpoint.text} after={after.text} label="Changes made" />
      <Button size="sm" variant="secondary" onClick={() => copy(checkpoint.text)}>Copy earlier text</Button>
    </div>
  );
}

function RestorePreview({
  noteId,
  epoch,
  checkpoint,
  flushForRestore,
  onDone,
}: {
  noteId: string;
  epoch: string;
  checkpoint: Checkpoint;
  flushForRestore: () => Promise<RestoreReadiness>;
  onDone: () => void;
}) {
  const saved = useQuery(api.collab.checkpointText, { noteId, checkpointId: checkpoint.id });
  const current = useQuery(api.collab.snapshot, { noteId });
  const restore = useMutation(api.collab.restoreCheckpoint);
  const [busy, setBusy] = useState(false);
  if (saved === undefined || current === undefined) return <p role="status" className="mt-2 type-body-sm text-text-2">Loading…</p>;
  if (!saved || current.status !== "ok") return <p className="mt-2 type-body-sm text-text-2">This version isn’t available.</p>;
  const previewVersion = current.version;
  return (
    <div className="mt-2 flex flex-col gap-3">
      <p className="type-body-sm text-text-2">Current note compared with this saved version:</p>
      <LineDiffView before={current.text} after={saved.text} label="Current note compared with saved version" />
      <p className="type-body-sm text-text-2">
        Restoring replaces the whole current note with this version, including anything written after it. The
        current text is saved first, so you can come back to it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => copy(saved.text)}>Copy this version</Button>
        <Button
          size="sm"
          pending={busy}
          disabled={saved.text === current.text}
          onClick={async () => {
            setBusy(true);
            try {
              const flushed = await flushForRestore();
              if (!flushed.ok) {
                toast.fail(RESTORE_BLOCKED[flushed.reason]);
                return;
              }
              const result = await restore({ noteId, epoch, checkpointId: checkpoint.id, expectedVersion: previewVersion });
              if (result.status === "ok") {
                toast.success("Restored as a new version");
                onDone();
              } else if (result.status === "stale") {
                toast("The note changed while you were comparing. Review the updated comparison.");
              } else if (result.status === "unchanged") {
                toast("The note already matches this version.");
              } else {
                toast.fail("Couldn’t restore this version.");
              }
            } catch {
              toast.fail("Couldn’t restore this version.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Restore this version
        </Button>
      </div>
    </div>
  );
}

export default function NoteHistoryDialog({
  open,
  onOpenChange,
  noteId,
  epoch,
  flushForRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  epoch: string;
  flushForRestore: () => Promise<RestoreReadiness>;
}) {
  const activity = useQuery(api.collab.activity, open ? { noteId } : "skip");
  const checkpoints = useQuery(api.collab.checkpoints, open ? { noteId } : "skip");
  const [selectedActivity, setSelectedActivity] = useState<Id<"noteActivity"> | null>(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Id<"noteCheckpoints"> | null>(null);
  const restorable = checkpoints?.find((item) => item.id === selectedCheckpoint) ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Changes</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription>Agent edits and saved versions of this note.</DialogDescription>
          <section aria-label="Activity" className="mt-4">
            <h3 className="border-b border-line py-2 type-label-sm text-text-2">Activity</h3>
            {activity?.length ? (
              <ul>
                {activity.map((item) => (
                  <li key={item.id} className="rule-row py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 type-body-sm text-text-1">
                        {describe(item)} <span className="type-caption text-text-2">· {when(item.createdAt)}</span>
                      </span>
                      {item.checkpointId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedActivity(selectedActivity === item.id ? null : item.id)}
                        >
                          {selectedActivity === item.id ? "Hide" : "View changes"}
                        </Button>
                      )}
                    </div>
                    {selectedActivity === item.id && <ActivityComparison noteId={noteId} item={item} />}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 type-body-sm text-text-2">No activity yet.</p>
            )}
          </section>
          <section aria-label="Saved versions" className="mt-4">
            <h3 className="border-b border-line py-2 type-label-sm text-text-2">Saved versions</h3>
            {checkpoints?.length ? (
              <ul>
                {checkpoints.map((item) => (
                  <li key={item.id} className="rule-row py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 type-body-sm text-text-1">
                        {CHECKPOINT_LABELS[item.reason]}
                        {item.agentName ? ` (${item.agentName})` : ""}{" "}
                        <span className="type-caption text-text-2">· {when(item.createdAt)}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedCheckpoint(selectedCheckpoint === item.id ? null : item.id)}
                      >
                        {selectedCheckpoint === item.id ? "Hide" : "Compare"}
                      </Button>
                    </div>
                    {restorable?.id === item.id && (
                      <RestorePreview
                        noteId={noteId}
                        epoch={epoch}
                        checkpoint={item}
                        flushForRestore={flushForRestore}
                        onDone={() => setSelectedCheckpoint(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 type-body-sm text-text-2">No saved versions yet.</p>
            )}
          </section>
        </DialogBody>
        <DialogFooter defaultAction="none">
          <DialogClose>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
