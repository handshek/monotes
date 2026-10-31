"use client";

import { Authenticated, Unauthenticated } from "convex/react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import SyncModal from "./sync-modal";
import {
  Dialog,
  DialogAction,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import { Button } from "@/components/sodium/ui/button";
import { Status, type StatusValue } from "@/components/sodium/ui/status";
import { Icon, DataBase, History, Key, Time } from "@/components/sodium/icon";
import { cn } from "@/lib/sodium/utils";
import { formatExactTime, useRelativeTime } from "@/lib/relative-time";
import AgentAccessDialog, { REOPEN_KEY } from "@/components/agents/agent-access-dialog";
import NoteHistoryDialog, { type RestoreReadiness } from "./note-history-dialog";
import type { SessionStatus } from "@/lib/collab/session";

interface NotesMetadataBarProps {
  lastEdited?: number;
  cloudStatus?: "local" | "syncing" | "synced" | "ai-enabled";
  noteId?: string;
  className?: string;
  /* Present for notes connected for live agent editing. */
  connected?: {
    status: SessionStatus | null;
    epoch: string;
    flushForRestore: () => Promise<RestoreReadiness>;
  };
  /* Saves pending typing and returns this device's text, before connecting. */
  prepareConnect?: () => Promise<string>;
}

function connectionLabel(status: SessionStatus | null): string {
  if (!status) return "Connecting…";
  switch (status.connection) {
    case "connecting":
      return "Connecting…";
    case "live":
      return status.pending > 0 ? "Sending…" : "Live";
    case "offline":
      return "Offline · saved on this device";
    case "signed_out":
      return "Signed out · saved on this device";
    case "deleted":
      return "Deleted";
    default:
      return "Not available · saved on this device";
  }
}

/* Where the shared connection stands, as a Status mark beside the label. */
function connectionTone(status: SessionStatus | null): StatusValue {
  switch (status?.connection) {
    case undefined:
    case "connecting":
      return "running";
    case "live":
      return status.pending > 0 ? "running" : "ok";
    case "offline":
    case "signed_out":
      return "paused";
    case "deleted":
      return "fail";
    default:
      return "warn";
  }
}

export default function NotesMetadataBar({
  lastEdited,
  cloudStatus = "local",
  noteId,
  className = "",
  connected,
  prepareConnect,
}: NotesMetadataBarProps) {
  const router = useRouter();
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [agentAccessOpen, setAgentAccessOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Connecting swaps in the collaborative editor; reopen the dialog there so
  // the person can go straight on to choosing which agents may use the note.
  useEffect(() => {
    if (!connected || !noteId) return;
    try {
      if (sessionStorage.getItem(REOPEN_KEY) === noteId) {
        sessionStorage.removeItem(REOPEN_KEY);
        setAgentAccessOpen(true);
      }
    } catch {
      // Without sessionStorage the person reopens the dialog themselves.
    }
  }, [connected, noteId]);

  const editedAgo = useRelativeTime(lastEdited);

  return (
    <React.Fragment>
      <div
        className={cn(
          "@container flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 py-4 type-label-sm text-text-2",
          className,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Icon icon={Time} />
          {lastEdited ? (
            <time
              dateTime={new Date(lastEdited).toISOString()}
              title={`Last edited ${formatExactTime(lastEdited)}`}
              className="truncate"
            >
              Edited {editedAgo}
            </time>
          ) : (
            <span>Not edited yet</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {connected && (
            <>
              <span role="status" aria-label="Sharing status" className="me-2 flex items-center">
                <Status size="sm" status={connectionTone(connected.status)}>
                  {connectionLabel(connected.status)}
                </Status>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <Icon icon={History} />
                {/* In a narrow bar (a phone, or a 60ch note) the glyph stands alone so the row fits; the name stays for screen readers. */}
                <span className="@max-[36rem]:sr-only">Changes</span>
              </Button>
            </>
          )}
          {noteId && (
            <Button variant="ghost" size="sm" onClick={() => setAgentAccessOpen(true)}>
              <Icon icon={Key} />
              <span className="@max-[36rem]:sr-only">Agent access</span>
            </Button>
          )}
          {!connected && cloudStatus === "local" && (
            <>
              <Unauthenticated>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAuthModalOpen(true)}
                  title="Sign in to sync to cloud"
                >
                  <Icon icon={DataBase} />
                  Local only
                </Button>
              </Unauthenticated>
              <Authenticated>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSyncModalOpen(true)}
                  title="Click to sync to cloud"
                >
                  <Icon icon={DataBase} />
                  Local only
                </Button>
              </Authenticated>
            </>
          )}
        </div>
      </div>
      {noteId && (
        <AgentAccessDialog
          open={agentAccessOpen}
          onOpenChange={setAgentAccessOpen}
          noteId={noteId}
          connected={Boolean(connected)}
          prepareConnect={prepareConnect}
        />
      )}
      {noteId && connected && (
        <NoteHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          noteId={noteId}
          epoch={connected.epoch}
          flushForRestore={connected.flushForRestore}
        />
      )}
      {noteId && (
        <SyncModal
          open={syncModalOpen}
          onOpenChange={setSyncModalOpen}
          noteId={noteId}
        />
      )}

      <Dialog open={authModalOpen} onOpenChange={setAuthModalOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Sign in to sync</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              To sync your notes to the cloud and access them from anywhere, you
              need to sign in.
            </DialogDescription>
          </DialogBody>
          <DialogFooter>
            <DialogClose>Stay local</DialogClose>
            <DialogAction onAction={() => router.push("/signin")}>Sign in</DialogAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </React.Fragment>
  );
}
