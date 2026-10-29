"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/sodium/ui/button";
import { CopyButton } from "@/components/sodium/ui/copy-button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/sodium/ui/item";
import { NativeSelect } from "@/components/sodium/ui/select";
import { StatusMark, type StatusValue } from "@/components/sodium/ui/status";
import { toast } from "@/components/sodium/ui/toast";
import { workRequest } from "./agent-messages";

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

/* The square mark that leads each row; the description beside it names the state. */
const STATE_MARK: Record<NoteAgent["state"], StatusValue> = {
  connected: "ok",
  used: "ok",
  waiting: "queued",
  unused: "idle",
};

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
      if (result.status !== "ok") toast.fail("Couldn’t change access. Try again.");
    } catch {
      toast.fail("Couldn’t change access. Try again.");
    }
  };

  const row = (agent: NoteAgent) => {
    const canCopy = agent.access !== "none" && agent.state !== "unused";
    const canSetUp = agent.state === "unused" || agent.state === "waiting";
    return (
      <Item key={agent.id} className="flex-wrap">
        <ItemMedia>
          <StatusMark status={STATE_MARK[agent.state]} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            <span>{agent.name}</span>
          </ItemTitle>
          <ItemDescription className="line-clamp-none">{describe(agent)}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <NativeSelect
            size="sm"
            aria-label={`Access for ${agent.name}`}
            className="w-32"
            value={agent.access}
            onChange={(event) => {
              if (isAccess(event.target.value)) void change(agent.id, event.target.value);
            }}
          >
            <option value="none">No access</option>
            <option value="read">Can read</option>
            <option value="edit">Can edit</option>
          </NativeSelect>
        </ItemActions>
        {(canCopy || canSetUp) && (
          <div className="flex basis-full flex-wrap gap-2 ps-5">
            {canCopy && (
              <CopyButton
                variant="secondary"
                showLabel
                label="request"
                value={() => workRequest({ origin, noteId, title: noteTitle, credentialFile: agent.credentialFile })}
              />
            )}
            {canSetUp && (
              <>
                <Button size="sm" variant="secondary" onClick={() => onSetUpAgain(agent.name)}>
                  {agent.state === "unused" ? "Set up a new connection" : "Set up again"}
                </Button>
                {/* Removing touches only this connection, and only when asked twice. */}
                <Button
                  size="sm"
                  variant={confirmRemove === agent.id ? "destructive" : "ghost"}
                  onClick={async () => {
                    if (confirmRemove !== agent.id) return setConfirmRemove(agent.id);
                    setConfirmRemove(null);
                    const result = await revoke({ connectionId: agent.id }).catch(() => null);
                    if (result?.status === "ok") toast.success(`${agent.name} removed`);
                    else toast.fail("Couldn’t remove it. Try again.");
                  }}
                >
                  {confirmRemove === agent.id ? `Confirm: remove ${agent.name}` : "Remove"}
                </Button>
              </>
            )}
          </div>
        )}
      </Item>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {withAccess.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="type-label-sm text-text-2">Agents with access to this note</h3>
          <ItemGroup aria-label="Agents with access to this note">{withAccess.map(row)}</ItemGroup>
        </section>
      )}
      {others.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h3 className="type-label-sm text-text-2">Your other agents</h3>
            <p className="type-caption text-text-2">Give one access without setting it up again.</p>
          </div>
          <ItemGroup aria-label="Your other agents">{others.map(row)}</ItemGroup>
        </section>
      )}
    </div>
  );
}
