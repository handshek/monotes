"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { copyToClipboard, setupMessage, workRequest, type GrantedAccess } from "./agent-messages";

const AGENTS = [
  { id: "Codex", hint: "desktop or CLI" },
  { id: "Claude Code", hint: "terminal or app" },
  { id: "Cursor", hint: "editor" },
  { id: "other", hint: "name it" },
] as const;

type AgentChoice = (typeof AGENTS)[number]["id"];

/*
 * The setup in progress for a note survives closing the dialog (or a
 * reload) in this tab only: the pairing id and the short-lived code needed
 * to show the message again. Nothing here is a lasting credential.
 */
const storedSetup = z.object({
  pairingId: z.string(),
  code: z.string(),
  expiresAt: z.number(),
  title: z.string(),
});
type StoredSetup = Omit<z.infer<typeof storedSetup>, "pairingId"> & { pairingId: Id<"agentPairings"> };

/* Shape check for an id this app stored itself; Convex checks it again on use. */
function isPairingId(value: string): value is Id<"agentPairings"> {
  return /^[A-Za-z0-9_;-]{8,64}$/.test(value);
}

function setupKey(noteId: string) {
  return `monotes-agent-setup:${noteId}`;
}

function readSetup(noteId: string): StoredSetup | null {
  try {
    const raw = sessionStorage.getItem(setupKey(noteId));
    const parsed = raw ? storedSetup.safeParse(JSON.parse(raw)) : null;
    if (!parsed?.success) return null;
    const { pairingId, ...rest } = parsed.data;
    return isPairingId(pairingId) ? { ...rest, pairingId } : null;
  } catch {
    return null;
  }
}

function writeSetup(noteId: string, setup: StoredSetup | null) {
  try {
    if (setup) sessionStorage.setItem(setupKey(noteId), JSON.stringify(setup));
    else sessionStorage.removeItem(setupKey(noteId));
  } catch {
    // Without session storage the setup still works until the dialog closes.
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const START_ERRORS: Record<string, string> = {
  signed_out: "Sign in to connect an agent.",
  invalid_name: "Give the agent a name of 1–60 characters.",
  invalid_site: "Agent setup needs this page to be served over HTTPS.",
  not_connected: "This note isn’t shared with agents.",
  invalid_replace: "That setup belongs to another note. Start again.",
  too_many_pending: "You have several setup messages waiting. Cancel one or wait 10 minutes.",
  rate_limited: "Too many setup messages this hour. Try again later.",
  too_many_connections: "You have the maximum number of agents. Remove one on the Agent access page first.",
  access_removed: "You removed this agent’s access, so it wasn’t set up again. Choose its access to start a new setup.",
};

const ALREADY_WORKS = (name: string) =>
  `${name} already works with Monotes, so it keeps its access. It hasn’t necessarily read this note yet.`;

async function copy(text: string, what: string) {
  if (await copyToClipboard(text)) toast.success(`${what} copied`);
  else toast.error("Couldn’t copy. Select the text and copy it instead.");
}

/* Connect a coding agent to this note with a one-time pairing code. */
export default function PairAgent({
  noteId,
  noteTitle,
  initialName,
  onStart,
  onDone,
}: {
  noteId: string;
  noteTitle: string;
  initialName?: string;
  /* A setup started here; keep this component shown until onDone. */
  onStart?: () => void;
  /* The person finished with a connected agent. */
  onDone?: () => void;
}) {
  const start = useAction(api.pairing.start);
  const cancel = useMutation(api.pairing.cancel);
  const [setup, setSetup] = useState<StoredSetup | null>(() => readSetup(noteId));
  const known = AGENTS.find((item) => item.id !== "other" && item.id === initialName)?.id;
  const [agent, setAgent] = useState<AgentChoice>(known ?? (initialName ? "other" : "Codex"));
  const [otherName, setOtherName] = useState(initialName && !known ? initialName : "");
  const [access, setAccess] = useState<GrantedAccess>("edit");
  const [busy, setBusy] = useState(false);
  const status = useQuery(api.pairing.status, setup ? { pairingId: setup.pairingId } : "skip");
  const waiting = status?.state === "waiting";
  const now = useNow(Boolean(setup) && (waiting || status === undefined));
  const replacing = setup && status ? { pairingId: setup.pairingId, name: status.name, access: status.access } : undefined;

  /* Go back to the form with this setup's choices, to change them explicitly. */
  const changeChoices = () => {
    if (status) {
      const known = AGENTS.find((item) => item.id !== "other" && item.id === status.name)?.id;
      setAgent(known ?? "other");
      setOtherName(known ? "" : status.name);
      setAccess(status.access);
    }
    remember(null);
  };
  const name = agent === "other" ? otherName.trim() : agent;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const remember = (next: StoredSetup | null) => {
    writeSetup(noteId, next);
    setSetup(next);
  };

  /* Leave the setup: forget it in this tab and hand back to the agent list. */
  const finish = () => {
    remember(null);
    onDone?.();
  };

  /*
   * A fresh setup uses the form's choices. A replacement ("New code",
   * "Start over") repeats the setup's own agent and access; the server
   * enforces the same, so a new code never changes what was chosen.
   */
  const create = async (replacing?: { pairingId: Id<"agentPairings">; name: string; access: GrantedAccess }) => {
    setBusy(true);
    try {
      const result = await start({
        noteId,
        name: replacing?.name ?? name,
        access: replacing?.access ?? access,
        siteOrigin: origin,
        replaces: replacing?.pairingId,
      });
      if (result.status === "created") {
        remember({ pairingId: result.pairingId, code: result.code, expiresAt: result.expiresAt, title: noteTitle });
        onStart?.();
      } else if (result.status === "already_connected") {
        toast(ALREADY_WORKS(replacing?.name ?? name));
        finish();
      } else {
        toast.error(START_ERRORS[result.status] ?? "Couldn’t create a setup message.");
      }
    } catch {
      toast.error("Couldn’t create a setup message. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = async () => {
    if (!setup) return;
    setBusy(true);
    try {
      const result = await cancel({ pairingId: setup.pairingId });
      if (result.status === "already_connected") {
        toast(ALREADY_WORKS(status?.name ?? name));
        finish();
      } else remember(null);
    } catch {
      toast.error("Couldn’t cancel. Try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // The setup no longer exists for this account (for example after signing out).
    if (setup && status === null) {
      writeSetup(noteId, null);
      setSetup(null);
    }
  }, [setup, status, noteId]);

  if (!setup || status === null) {
    return (
      <div className="space-y-4 text-sm">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs text-muted-foreground">Which agent do you use?</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Agent">
            {AGENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={agent === item.id}
                onClick={() => setAgent(item.id)}
                className={cn(
                  "rounded-md border px-2 py-2 text-left",
                  agent === item.id && "border-foreground ring-1 ring-foreground",
                )}
              >
                <span className="block">{item.id === "other" ? "Other" : item.id}</span>
                <span className="block text-xs text-muted-foreground">{item.hint}</span>
              </button>
            ))}
          </div>
          {agent === "other" && (
            <Input
              aria-label="Agent name"
              placeholder="Agent name"
              maxLength={60}
              value={otherName}
              onChange={(event) => setOtherName(event.target.value)}
            />
          )}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs text-muted-foreground">
            What may it do with <span className="font-medium text-foreground">{noteTitle}</span>?
          </legend>
          {(["read", "edit"] as const).map((option) => (
            <label
              key={option}
              className={cn("flex cursor-pointer gap-3 rounded-md border px-3 py-2", access === option && "border-foreground ring-1 ring-foreground")}
            >
              <input type="radio" name="agent-access" value={option} checked={access === option} onChange={() => setAccess(option)} />
              <span>
                {option === "read" ? "Can read" : "Can edit"}
                <span className="block text-xs text-muted-foreground">
                  {option === "read"
                    ? "It sees this note’s text but can’t change it."
                    : "It reads and edits this note while you type. You can see and restore every edit."}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="border-l-2 pl-3 text-xs text-muted-foreground">
          Only this note. Your other notes stay out of reach, and you can remove access at any time.
        </p>
        <Button disabled={busy || !name} onClick={() => create()}>
          Create setup message
        </Button>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">What happens next?</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>You paste one message into your agent. It has a code that works once, for 10 minutes, for this note.</li>
            <li>Your agent uses the code to save its own private access file on your computer, then reads this note.</li>
            <li>This window shows when the code is used and when your agent has read the note.</li>
            <li>Monotes doesn’t start or message your agent. It can confirm the code was used, not which program used it.</li>
          </ul>
        </details>
      </div>
    );
  }

  if (status === undefined) return <p className="text-sm text-muted-foreground">Checking your agent setup…</p>;

  const expired = status.state === "expired" || (waiting && setup.expiresAt <= now);
  if (expired || status.state === "cancelled" || status.state === "access_removed") {
    return (
      <div className="space-y-3 text-sm" role="status">
        <p>
          {expired
            ? "This code expired. Nothing was connected."
            : status.state === "cancelled"
              ? "This setup was cancelled. Nothing is connected from it."
              : `${status.name} no longer has access to this note.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {expired && (
            <Button disabled={busy} onClick={() => create(replacing)}>
              Create a new message
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={changeChoices}>
            {expired ? "Change agent or access" : "Start again"}
          </Button>
        </div>
      </div>
    );
  }

  if (status.state === "connected") {
    const request = workRequest({ origin, noteId, title: setup.title, credentialFile: status.credentialFile });
    return (
      <div className="space-y-3 text-sm">
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
          <p className="font-medium text-green-700 dark:text-green-400">✓ {status.name} is connected</p>
          <p className="mt-1 text-xs">
            It can {status.access === "edit" ? "read and edit" : "read"} “{setup.title}”. It read the note at{" "}
            {status.verifiedAt ? clock(status.verifiedAt) : "—"}.
          </p>
        </div>
        <p>Next time, paste this into {status.name} and add what you want done:</p>
        <pre aria-label="Request for your agent" className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs">{request}</pre>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => copy(request, "Request")}>Copy request</Button>
          <Button variant="outline" onClick={finish}>
            Done
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">The request holds only links and the access file’s name — no code or key.</p>
      </div>
    );
  }

  const message = setupMessage({
    origin,
    noteId,
    title: setup.title,
    access: status.access,
    code: setup.code,
    expiresAt: setup.expiresAt,
  });
  const remaining = Math.max(0, setup.expiresAt - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0");
  return (
    <div className="space-y-3 text-sm">
      {waiting ? (
        <>
          <p>
            Paste this into <span className="font-medium">{status.name}</span>:
          </p>
          <pre aria-label="Setup message" className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs">{message}</pre>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => copy(message, "Setup message")}>Copy message</Button>
            <Button variant="ghost" disabled={busy} onClick={() => create(replacing)}>
              New code
            </Button>
            <Button variant="ghost" disabled={busy} onClick={cancelSetup}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}
      <ol role="status" aria-label="Connection progress" className="space-y-1 rounded-md border p-3">
        <li className={waiting ? "" : "text-green-700 dark:text-green-400"}>
          {waiting
            ? `◌ Waiting for ${status.name} to use the code · ${minutes}:${seconds} left`
            : `✓ Code accepted at ${status.acceptedAt ? clock(status.acceptedAt) : "—"}`}
        </li>
        <li className={waiting ? "text-muted-foreground" : ""}>
          {waiting ? `○ ${status.name} reads “${setup.title}”` : `◌ Waiting for ${status.name} to read “${setup.title}” to test its access`}
        </li>
      </ol>
      {!waiting && status.connectionVerified && (
        <div className="space-y-2" role="status">
          <p>
            {status.name} already works with Monotes: it has read another note you gave it. It hasn’t read “
            {setup.title}” yet, so this note isn’t confirmed.
          </p>
          <Button variant="outline" size="sm" onClick={finish}>
            Done
          </Button>
        </div>
      )}
      {!waiting && !status.connectionVerified && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            If your agent stopped after using the code, ask it to read the note. If it lost its access file, start over:
            this setup’s connection is removed first.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => create(replacing)}>
              Start over with a new code
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={cancelSetup}>
              Cancel setup
            </Button>
          </div>
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">If {status.name} asks for permission</summary>
        <p className="mt-2">
          It needs to contact {origin} and save one private file in ~/.config/monotes. Agents that ask before using
          the network or writing files will ask you to allow both.
        </p>
      </details>
    </div>
  );
}
