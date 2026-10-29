"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/sodium/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/sodium/ui/collapsible";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import { toast } from "@/components/sodium/ui/toast";
import LineDiffView from "@/components/notes/line-diff-view";
import { markConnected } from "@/lib/collab/store";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB } from "@/lib/local-db";
import { noteTitle as titleOf } from "../../../convex/lib/collabCore";
import { CreateAgentKey } from "./agent-setup";
import NoteAgents from "./note-agents";
import PairAgent from "./pair-agent";

/* Set when a note is connected so the dialog reopens in the collaborative editor. */
export const REOPEN_KEY = "monotes-reopen-agent-access";

interface AgentAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  connected: boolean;
  /* Saves pending local typing and returns the note's text on this device. */
  prepareConnect?: () => Promise<string>;
}

type Choice = { localText: string; cloudText: string; cloudUpdatedAt: number };

/* What agent access means, in one line plus details on request. */
export function AgentAccessExplanation() {
  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-measure type-body-sm text-text-2">
        Let a coding agent you already use, such as Codex, Claude Code or Cursor, read or edit the notes you choose
        while you keep typing.
      </p>
      <Collapsible>
        <CollapsibleTrigger size="sm">How it works</CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="flex max-w-measure list-disc flex-col gap-1 ps-5 pt-2 type-body-sm text-text-2">
            <li>Each agent reaches only the notes you give it, and you can remove access any time.</li>
            <li>Monotes doesn’t start your agent, sign in to it, or send it messages. You keep asking it things where you normally do.</li>
            <li>A note you share is stored in your Monotes cloud account so your agent can reach it. Cloud notes aren’t end-to-end encrypted.</li>
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ConnectNote({ noteId, prepareConnect }: { noteId: string; prepareConnect?: () => Promise<string> }) {
  const enable = useMutation(api.collab.enable);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);

  const finish = async (result: Awaited<ReturnType<typeof enable>>, localText: string) => {
    switch (result.status) {
      case "enabled":
      case "already_enabled":
        try {
          sessionStorage.setItem(REOPEN_KEY, noteId);
        } catch {
          // Optional convenience only.
        }
        await markConnected(noteId, result.epoch, result.text, Date.now());
        toast.success("This note is ready for agents");
        setChoice(null);
        return;
      case "needs_choice":
      case "cloud_changed":
        if (result.status === "cloud_changed") toast("The cloud copy changed. Compare again.");
        setChoice({ localText, cloudText: result.cloudText, cloudUpdatedAt: result.cloudUpdatedAt });
        return;
      case "deleted":
        toast.fail("This note was deleted from your cloud account.");
        return;
      case "too_large":
        toast.fail("This note is too large to share with agents.");
        return;
      default:
        toast.fail("Sign in to share this note with agents.");
    }
  };

  const connect = async (picked?: "local" | "cloud") => {
    setBusy(true);
    try {
      const localText = picked && choice ? choice.localText : (await prepareConnect?.()) ?? "";
      const result = await enable(
        picked && choice
          ? { noteId, localText, choice: picked, expectedCloudUpdatedAt: choice.cloudUpdatedAt }
          : { noteId, localText },
      );
      await finish(result, localText);
    } catch {
      toast.fail("Couldn’t connect this note. Your text is still saved on this device.");
    } finally {
      setBusy(false);
    }
  };

  if (choice) {
    return (
      <div className="flex flex-col gap-3">
        <p className="type-body-sm text-text-1">
          Your cloud account already has a different version of this note. Choose which text agents should start
          from. The other version is kept as a saved version you can compare and restore.
        </p>
        <LineDiffView before={choice.cloudText} after={choice.localText} label="Cloud copy compared with this device" />
        <p className="type-caption text-text-2">Removed lines are only in the cloud copy; added lines are only on this device.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => connect("local")}>Use this device’s text</Button>
          <Button disabled={busy} variant="secondary" onClick={() => connect("cloud")}>Use the cloud text</Button>
          <Button disabled={busy} variant="ghost" onClick={() => setChoice(null)}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <AgentAccessExplanation />
      <Button className="self-start" pending={busy} onClick={() => connect()}>
        Allow agents on this note
      </Button>
    </div>
  );
}

function NoteAccess({ noteId, noteTitle }: { noteId: string; noteTitle: string }) {
  const agents = useQuery(api.agents.noteGrants, { noteId });
  const [setUpName, setSetUpName] = useState<string | null>(null);
  // Open when a setup from this tab is still in progress; stays open until
  // the person finishes with "Done".
  const [connecting, setConnecting] = useState(() => {
    try {
      return sessionStorage.getItem(`monotes-agent-setup:${noteId}`) !== null;
    } catch {
      return false;
    }
  });
  const [manual, setManual] = useState(false);
  if (agents === undefined) return null;
  const list = agents ?? [];
  const showPairing = list.length === 0 || connecting || setUpName !== null;

  return (
    <div className="flex flex-col gap-6">
      {list.length > 0 && (
        <NoteAgents
          noteId={noteId}
          noteTitle={noteTitle}
          agents={list}
          onSetUpAgain={(name) => {
            setSetUpName(name);
            setConnecting(true);
          }}
        />
      )}
      <section className="flex flex-col gap-3" aria-label="Connect an agent">
        {showPairing ? (
          <>
            <h3 className="type-heading text-text-1">Agent setup</h3>
            <PairAgent
              key={setUpName ?? "new"}
              noteId={noteId}
              noteTitle={noteTitle}
              initialName={setUpName ?? undefined}
              onStart={() => setConnecting(true)}
              onDone={() => {
                setConnecting(false);
                setSetUpName(null);
              }}
            />
          </>
        ) : (
          <Button className="self-start" variant="secondary" size="sm" onClick={() => setConnecting(true)}>
            Connect another agent
          </Button>
        )}
      </section>
      <Collapsible open={manual} onOpenChange={setManual}>
        <CollapsibleTrigger size="sm">Set up manually with a key instead</CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 pt-3">
            <p className="type-caption text-text-2">
              For people who prefer to manage a key and environment variables themselves. The key is shown once.
            </p>
            {manual && <CreateAgentKey />}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <p className="type-body-sm">
        <Link href="/agent-access" className="text-text-1 underline underline-offset-4">
          Manage all agents
        </Link>
      </p>
    </div>
  );
}

export default function AgentAccessDialog({ open, onOpenChange, noteId, connected, prepareConnect }: AgentAccessDialogProps) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const localContent = useLiveQuery(async () => (await getDB().notes.get(noteId))?.content ?? "", [noteId]);
  const noteTitle = titleOf(localContent ?? "");
  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Agent access</DialogTitle>
        </DialogHeader>
        <DialogBody className="gap-5">
          <DialogDescription>
            For <span className="text-text-1">{noteTitle}</span>
          </DialogDescription>
          {isLoading ? null : !isAuthenticated ? (
            <div className="flex flex-col gap-3">
              <AgentAccessExplanation />
              <p className="type-body-sm text-text-1">Agent access uses your Monotes account, so sign in first.</p>
              <Button className="self-start" onClick={() => router.push("/signin")}>Sign in</Button>
            </div>
          ) : connected ? (
            <NoteAccess noteId={noteId} noteTitle={noteTitle} />
          ) : (
            <ConnectNote noteId={noteId} prepareConnect={prepareConnect} />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
