"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/sodium/ui/alert";
import { Button } from "@/components/sodium/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/sodium/ui/collapsible";
import { CopyButton } from "@/components/sodium/ui/copy-button";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/sodium/ui/field";
import { Input } from "@/components/sodium/ui/input";
import { RadioGroup, RadioGroupOption } from "@/components/sodium/ui/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@/components/sodium/ui/segmented-control";
import { StatusMark } from "@/components/sodium/ui/status";
import { toast } from "@/components/sodium/ui/toast";
import { setupMessage, workRequest, type GrantedAccess } from "./agent-messages";

const AGENTS = [
  { id: "Codex" },
  { id: "Claude Code" },
  { id: "Cursor" },
  { id: "other" },
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

function isGrantedAccess(value: unknown): value is GrantedAccess {
  return value === "read" || value === "edit";
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
        toast.fail(START_ERRORS[result.status] ?? "Couldn’t create a setup message.");
      }
    } catch {
      toast.fail("Couldn’t create a setup message. Try again.");
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
      toast.fail("Couldn’t cancel. Try again.");
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
      <div className="flex flex-col gap-5">
        <FieldSet>
          <FieldLegend>Which agent do you use?</FieldLegend>
          {/* Toggle buttons that act as one choice: pressing the chosen one keeps it. */}
          <SegmentedControl
            multiple
            size="sm"
            aria-label="Agent"
            value={[agent]}
            onValueChange={(values) => {
              const next = AGENTS.find((item) => item.id !== agent && values.includes(item.id));
              if (next) setAgent(next.id);
            }}
          >
            {AGENTS.map((item) => (
              <SegmentedControlItem key={item.id} value={item.id}>
                {item.id === "other" ? "Other" : item.id}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          {agent === "other" && (
            <Field>
              <FieldLabel>Agent name</FieldLabel>
              <Input maxLength={60} value={otherName} onChange={(event) => setOtherName(event.target.value)} />
            </Field>
          )}
        </FieldSet>
        <FieldSet>
          <FieldLegend>
            What may it do with <span className="text-text-1">{noteTitle}</span>?
          </FieldLegend>
          <RadioGroup
            value={access}
            onValueChange={(value) => {
              if (isGrantedAccess(value)) setAccess(value);
            }}
          >
            <RadioGroupOption value="read" label="Can read" description="It sees this note’s text but can’t change it." />
            <RadioGroupOption
              value="edit"
              label="Can edit"
              description="It reads and edits this note while you type. You can see and restore every edit."
            />
          </RadioGroup>
        </FieldSet>
        <p className="type-caption text-text-2">
          Only this note. Your other notes stay out of reach, and you can remove access at any time.
        </p>
        <Button className="self-start" pending={busy} disabled={!name} onClick={() => create()}>
          Create setup message
        </Button>
        <Collapsible>
          <CollapsibleTrigger size="sm">What happens next</CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex max-w-measure list-disc flex-col gap-1 ps-5 pt-2 type-body-sm text-text-2">
              <li>You paste one message into your agent. It has a code that works once, for 10 minutes, for this note.</li>
              <li>Your agent uses the code to save its own private access file on your computer, then reads this note.</li>
              <li>This window shows when the code is used and when your agent has read the note.</li>
              <li>Monotes doesn’t start or message your agent. It can confirm the code was used, not which program used it.</li>
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  if (status === undefined) return <p className="type-body-sm text-text-2">Checking your agent setup…</p>;

  const expired = status.state === "expired" || (waiting && setup.expiresAt <= now);
  if (expired || status.state === "cancelled" || status.state === "access_removed") {
    return (
      <Alert role="status" status={expired ? "warn" : "neutral"}>
        <AlertDescription>
          {expired
            ? "This code expired, so nothing was connected."
            : status.state === "cancelled"
              ? "This setup was cancelled, so nothing is connected from it."
              : `${status.name} no longer has access to this note.`}
        </AlertDescription>
        <AlertAction>
          {expired && (
            <Button size="sm" pending={busy} onClick={() => create(replacing)}>
              Create a new message
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={changeChoices}>
            {expired ? "Change agent or access" : "Start again"}
          </Button>
        </AlertAction>
      </Alert>
    );
  }

  if (status.state === "connected") {
    const request = workRequest({ origin, noteId, title: setup.title, credentialFile: status.credentialFile });
    const may = status.access === "edit" ? "read and edit" : "read";
    return (
      <div className="flex flex-col gap-3">
        <Alert status="ok">
          <AlertTitle>{status.name} is connected</AlertTitle>
          <AlertDescription>
            It can {may} “{setup.title}”{status.verifiedAt ? ` and read it at ${clock(status.verifiedAt)}` : ""}.
          </AlertDescription>
        </Alert>
        <p className="type-body-sm text-text-1">Next time, paste this into {status.name} and add what you want done:</p>
        <pre
          aria-label="Request for your agent"
          className="code-surface min-w-0 p-3 type-code-sm break-words whitespace-pre-wrap text-text-1"
        >
          {request}
        </pre>
        <div className="flex flex-wrap gap-2">
          <CopyButton variant="secondary" size="default" showLabel label="request" value={request} />
          <Button variant="secondary" onClick={finish}>
            Done
          </Button>
        </div>
        <p className="type-caption text-text-2">The request holds only links and the access file’s name, no code or key.</p>
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
    <div className="flex flex-col gap-3">
      {waiting ? (
        <>
          <p className="type-body-sm text-text-1">
            Paste this into <span className="mono">{status.name}</span>:
          </p>
          <pre
            aria-label="Setup message"
            className="code-surface min-w-0 p-3 type-code-sm break-words whitespace-pre-wrap text-text-1"
          >
            {message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <CopyButton variant="secondary" size="default" showLabel label="message" value={message} />
            <Button variant="ghost" disabled={busy} onClick={() => create(replacing)}>
              New code
            </Button>
            <Button variant="ghost" disabled={busy} onClick={cancelSetup}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}
      <ol role="status" aria-label="Connection progress" className="frame">
        <li className="rule-row flex items-start gap-2 px-inset py-2 type-body-sm text-text-1">
          <StatusMark status={waiting ? "running" : "ok"} />
          <span className="min-w-0">
            {waiting ? (
              <>
                Waiting for {status.name} to use the code · <span className="data">{minutes}:{seconds}</span> left
              </>
            ) : (
              `Code accepted at ${status.acceptedAt ? clock(status.acceptedAt) : "—"}`
            )}
          </span>
        </li>
        <li className={`rule-row flex items-start gap-2 px-inset py-2 type-body-sm ${waiting ? "text-text-2" : "text-text-1"}`}>
          <StatusMark status={waiting ? "idle" : "running"} />
          <span className="min-w-0">
            {waiting ? `${status.name} reads “${setup.title}”` : `Waiting for ${status.name} to read “${setup.title}” to test its access`}
          </span>
        </li>
      </ol>
      {!waiting && status.connectionVerified && (
        <div className="flex flex-col gap-2" role="status">
          <p className="type-body-sm text-text-1">
            {status.name} already works with Monotes: it has read another note you gave it. It hasn’t read “
            {setup.title}” yet, so this note isn’t confirmed.
          </p>
          <Button className="self-start" variant="secondary" size="sm" onClick={finish}>
            Done
          </Button>
        </div>
      )}
      {!waiting && !status.connectionVerified && (
        <div className="flex flex-col gap-2">
          <p className="type-caption text-text-2">
            If your agent stopped after using the code, ask it to read the note. If it lost its access file, start over:
            this setup’s connection is removed first.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => create(replacing)}>
              Start over with a new code
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={cancelSetup}>
              Cancel setup
            </Button>
          </div>
        </div>
      )}
      <Collapsible>
        <CollapsibleTrigger size="sm" summary={`If ${status.name} asks`}>
          Permissions
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="max-w-measure pt-2 type-body-sm text-text-2">
            It needs to contact {origin} and save one private file in ~/.config/monotes. Agents that ask before using
            the network or writing files will ask you to allow both.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
