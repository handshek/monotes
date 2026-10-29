"use client";

import { CounterClockwiseClockIcon, UpdateIcon } from "@radix-ui/react-icons";
import { CircleCheckBigIcon, DatabaseIcon, History, KeyRound } from "lucide-react";
import { Authenticated, Unauthenticated } from "convex/react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import SyncModal from "./sync-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import AgentAccessDialog, { REOPEN_KEY } from "@/components/agents/agent-access-dialog";
import NoteHistoryDialog, { type RestoreReadiness } from "./note-history-dialog";
import type { SessionStatus } from "@/lib/collab/session";

interface NotesMetadataBarProps {
  lastEdited?: number;
  cloudStatus?: "local" | "syncing" | "synced" | "ai-enabled";
  noteId?: string;
  className?: string;
  isSyncing?: boolean;
  syncComplete?: boolean;
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

export default function NotesMetadataBar({
  lastEdited,
  cloudStatus = "local",
  noteId,
  className = "",
  isSyncing = false,
  syncComplete = false,
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

  const formatLastEdited = (timestamp: number) => {
    try {
      const date = new Date(timestamp);
      const day = date.getDate().toString().padStart(2, "0");
      const month = date
        .toLocaleString("en-US", { month: "short" })
        .toUpperCase();
      const year = date.getFullYear().toString().slice(-2);
      const time = date.toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      return `${time} · ${day}-${month}-${year}`;
    } catch {
      return "unknown";
    }
  };

  return (
    <React.Fragment>
      <div
        className={`flex items-center justify-between text-xs text-muted-foreground px-2 py-4 ${className}`}
      >
        <div
          className="flex items-center gap-2"
          title="Last Edited"
          aria-label="last edited"
        >
          <CounterClockwiseClockIcon className="size-3" />
          <span>{lastEdited ? formatLastEdited(lastEdited) : "never"}</span>
        </div>

        <div className="flex items-center gap-3">
          {connected && (
            <>
              <span role="status" aria-label="Sharing status" className="flex items-center gap-2">
                {connectionLabel(connected.status)}
              </span>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="text-xs rounded-md hover:bg-muted/80 transition-colors cursor-pointer flex items-center gap-1"
              >
                <History className="size-3" />
                Changes
              </button>
            </>
          )}
          {noteId && (
            <button
              type="button"
              onClick={() => setAgentAccessOpen(true)}
              className="text-xs rounded-md hover:bg-muted/80 transition-colors cursor-pointer flex items-center gap-1"
            >
              <KeyRound className="size-3" />
              Agent access
            </button>
          )}
          {!connected && cloudStatus === "local" && (
            <div className="">
              <Unauthenticated>
                <button
                  onClick={() => setAuthModalOpen(true)}
                  className="text-xs rounded-md hover:bg-muted/80 transition-colors cursor-pointer flex items-center gap-2"
                  title="Sign in to sync to cloud"
                >
                  <DatabaseIcon className="size-3" />
                  Local Only
                </button>
              </Unauthenticated>
              <Authenticated>
                <button
                  onClick={() => setSyncModalOpen(true)}
                  className="text-xs rounded-md hover:bg-muted/80 transition-colors cursor-pointer flex items-center gap-2"
                  title="Click to sync to cloud"
                >
                  <DatabaseIcon className="size-3" />
                  Local Only
                </button>
              </Authenticated>
            </div>
          )}
          {!connected && isSyncing && (
            <span className="text-muted-foreground flex items-center gap-2">
              <UpdateIcon className="size-3 animate-spin" />
              Syncing...
            </span>
          )}
          {!connected && !isSyncing && syncComplete && (
            <span
              className="text-blue-500 flex items-center gap-2"
              title="Synced to cloud"
            >
              <CircleCheckBigIcon className="size-3" />
              Synced
            </span>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in required</DialogTitle>
            <DialogDescription>
              To sync your notes to the cloud and access them from anywhere, you
              need to sign in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAuthModalOpen(false)}>
              Stay Local
            </Button>
            <Button onClick={() => router.push("/signin")}>Sign In</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </React.Fragment>
  );
}
