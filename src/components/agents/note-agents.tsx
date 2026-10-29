"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { copyToClipboard, workRequest } from "./agent-messages";

type NoteAgent = NonNullable<FunctionReturnType<typeof api.agents.noteGrants>>[number];

function day(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/* What Monotes actually knows about this agent, in plain words. */
function describe(agent: NoteAgent): string {
  switch (agent.state) {
    case "connected":
      return agent.readThisNoteAt ? `Connected · read this note ${day(agent.readThisNoteAt)}` : "Connected · hasn’t read this note yet";
    case "waiting":
      return "Code accepted · hasn’t read a note yet";
    case "used":
      return agent.lastUsedAt ? `Set up manually · last used ${day(agent.lastUsedAt)}` : "Set up manually";
    case "unused":
      return "Set up manually · never used. Its key can’t be shown again.";
  }
}

function isAccess(value: string): value is "none" | "read" | "edit" {
  return value === "none" || value === "read" || value === "edit";
}

/*
 * The person's agents for this note: those with access first, then agents
 * connected before, which can be given this note without setting up again.
 */
export default function NoteAgents({
  noteId,
  noteTitle,
  agents,
  onSetUpAgain,
}: {
  noteId: string;
  noteTitle: string;
  agents: NoteAgent[];
  onSetUpAgain: (name: string) => void;
}) {
  const setGrant = useMutation(api.agents.setGrant);
  const revoke = useMutation(api.agents.revokeConnection);
  const [confirmRemove, setConfirmRemove] = useState<Id<"agentConnections"> | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const withAccess = agents.filter((agent) => agent.access !== "none");
  const others = agents.filter((agent) => agent.access === "none");

  const change = async (connectionId: Id<"agentConnections">, access: "none" | "read" | "edit") => {
    try {
      const result = await setGrant({ noteId, connectionId, access });
      if (result.status !== "ok") toast.error("Couldn’t change access. Try again.");
    } catch {
      toast.error("Couldn’t change access. Try again.");
    }
  };

  const row = (agent: NoteAgent) => (
    <li key={agent.id} className="space-y-2 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{agent.name}</div>
          <div className="text-xs text-muted-foreground">{describe(agent)}</div>
        </div>
        <select
          aria-label={`Access for ${agent.name}`}
          className="rounded-md border bg-background px-2 py-1"
          value={agent.access}
          onChange={(event) => {
            if (isAccess(event.target.value)) void change(agent.id, event.target.value);
          }}
        >
          <option value="none">No access</option>
          <option value="read">Can read</option>
          <option value="edit">Can edit</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        {agent.access !== "none" && agent.state !== "unused" && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              const text = workRequest({ origin, noteId, title: noteTitle, credentialFile: agent.credentialFile });
              if (await copyToClipboard(text)) toast.success(`Request for ${agent.name} copied`);
              else toast.error("Couldn’t copy. Try again.");
            }}
          >
            Copy request
          </Button>
        )}
        {(agent.state === "unused" || agent.state === "waiting") && (
          <>
            <Button size="sm" variant="outline" onClick={() => onSetUpAgain(agent.name)}>
              {agent.state === "unused" ? "Set up a new connection" : "Set up again"}
            </Button>
            {/* Removing touches only this connection, and only when asked twice. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (confirmRemove !== agent.id) return setConfirmRemove(agent.id);
                setConfirmRemove(null);
                const result = await revoke({ connectionId: agent.id }).catch(() => null);
                if (result?.status === "ok") toast.success(`${agent.name} removed`);
                else toast.error("Couldn’t remove it. Try again.");
              }}
            >
              {confirmRemove === agent.id ? `Confirm: remove ${agent.name}` : "Remove"}
            </Button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className="space-y-4 text-sm">
      {withAccess.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs text-muted-foreground">Agents with access to this note</h3>
          <ul aria-label="Agents with access to this note" className="divide-y rounded-md border">
            {withAccess.map(row)}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs text-muted-foreground">Your other agents — give one access without setting it up again</h3>
          <ul aria-label="Your other agents" className="divide-y rounded-md border">
            {others.map(row)}
          </ul>
        </section>
      )}
    </div>
  );
}
