"use client";

import Link from "next/link";
import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLiveQuery } from "dexie-react-hooks";
import Navbar from "@/app/(notes)/navbar";
import { getNote } from "@/lib/local-notes";
import { noteTitle } from "../../../../convex/lib/collabCore";
import { AgentAccessExplanation } from "@/components/agents/agent-access-dialog";
import { CreateAgentKey } from "@/components/agents/agent-setup";
import { Button } from "@/components/sodium/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/sodium/ui/collapsible";
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
import { Frame, FrameBody, FrameHeader, FrameTitle } from "@/components/sodium/ui/frame";
import { Input } from "@/components/sodium/ui/input";
import { StatusMark, type StatusValue } from "@/components/sodium/ui/status";
import { Tag } from "@/components/sodium/ui/tag";
import { toast } from "@/components/sodium/ui/toast";

const STATE_LABELS = {
  connected: "Connected",
  waiting: "Code accepted, hasn’t read a note yet",
  used: "Set up manually",
  unused: "Set up manually, never used. Its key can’t be shown again; connect it again from a note",
} as const;

/* The square mark that leads each agent; the words beside it name the state. */
const STATE_MARKS: Record<keyof typeof STATE_LABELS, StatusValue> = {
  connected: "ok",
  used: "ok",
  waiting: "queued",
  unused: "idle",
};

type Target = { id: Id<"agentConnections">; name: string };

function Connections() {
  const connections = useQuery(api.agents.listConnections);
  const setGrant = useMutation(api.agents.setGrant);
  const revoke = useMutation(api.agents.revokeConnection);
  const rename = useMutation(api.agents.renameConnection);
  // The dialog keeps its last target while it closes, so the title doesn't empty mid-fade.
  const [revoking, setRevoking] = useState<Target | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [editing, setEditing] = useState<Target | null>(null);
  // Titles come from this device's copies; the server list holds only note ids.
  const titles = useLiveQuery(async () => {
    const ids = [...new Set((connections ?? []).flatMap((connection) => connection.notes.map((note) => note.noteId)))];
    const rows = await Promise.all(ids.map((id) => getNote(id)));
    return new Map(rows.flatMap((row) => (row ? [[row.id, noteTitle(row.content)] as const] : [])));
  }, [connections]);

  if (connections === undefined) return null;
  return (
    <>
      {connections.length === 0 ? (
        <p className="p-inset type-body-sm text-text-2">No agents connected yet.</p>
      ) : (
        <ul aria-label="Connected agents">
          {connections.map((connection) => (
            <li key={connection.id} className="rule-row flex flex-col gap-3 p-inset">
              <div className="flex flex-wrap items-start justify-between gap-2">
                {editing?.id === connection.id ? (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const result = await rename({ connectionId: connection.id, name: editing.name });
                      if (result.status === "ok") setEditing(null);
                      else toast.fail("Use a name of 1–60 characters.");
                    }}
                  >
                    <Input
                      size="sm"
                      aria-label="Agent name"
                      value={editing.name}
                      maxLength={60}
                      onChange={(event) => setEditing({ id: connection.id, name: event.target.value })}
                    />
                    <Button size="sm" type="submit">Save</Button>
                  </form>
                ) : (
                  <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
                    <StatusMark status={STATE_MARKS[connection.state]} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="type-code text-text-1">{connection.name}</div>
                      <div className="type-caption text-text-2">
                        {STATE_LABELS[connection.state]} · added {new Date(connection.createdAt).toLocaleDateString()}
                        {connection.lastUsedAt ? ` · last used ${new Date(connection.lastUsedAt).toLocaleString()}` : ""}
                        {connection.credentialFile ? ` · access file ${connection.credentialFile}` : ""}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: connection.id, name: connection.name })}>
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setRevoking({ id: connection.id, name: connection.name });
                      setRevokeOpen(true);
                    }}
                  >
                    Revoke key
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1 ps-5">
                <div className="type-label-sm text-text-2">Notes this agent can use</div>
                {connection.notes.length === 0 ? (
                  <p className="type-caption text-text-2">None. Allow it on a note from that note’s Agent access menu.</p>
                ) : (
                  <ul className="flex flex-col">
                    {connection.notes.map((note) => (
                      <li key={note.noteId} className="flex min-h-(--row-sm) items-center justify-between gap-2 type-body-sm">
                        <Link href={`/${note.noteId}`} className="min-w-0 truncate text-text-1 underline underline-offset-4">
                          {titles?.get(note.noteId) ?? note.noteId}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2">
                          <Tag size="sm" variant="outline">{note.access === "edit" ? "Can edit" : "Can read"}</Tag>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const result = await setGrant({ noteId: note.noteId, connectionId: connection.id, access: "none" });
                              if (result.status !== "ok") toast.fail("Couldn’t remove access.");
                            }}
                          >
                            Remove access
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {connection.moreNotes && <p className="type-caption text-text-2">And more notes not listed here.</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog role="alertdialog" open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Revoke “{revoking?.name}”?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              The key stops working on its next request and loses access to every note. Its past edits stay in each
              note’s history. This can’t be undone; create a new key if you need one again.
            </DialogDescription>
          </DialogBody>
          <DialogFooter>
            <DialogClose>Cancel</DialogClose>
            <DialogAction
              variant="destructive"
              onAction={async () => {
                if (!revoking) return;
                const result = await revoke({ connectionId: revoking.id });
                if (result.status === "ok") toast.success("Key revoked");
                else toast.fail("Couldn’t revoke the key.");
              }}
            >
              Revoke key
            </DialogAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AgentAccessPage() {
  return (
    <div className="min-h-dvh bg-page p-2 text-text-1">
      <Navbar />
      <main className="flex">
        <section className="mx-auto flex w-full max-w-(--overlay-lg) flex-1 flex-col gap-6 px-4 py-16">
          <h1 className="type-title">Agent access</h1>
          <AgentAccessExplanation />
          <AuthLoading>{null}</AuthLoading>
          <Unauthenticated>
            <p className="type-body-sm text-text-1">
              <Link href="/signin" className="underline underline-offset-4">Sign in</Link> to manage agent keys.
            </p>
          </Unauthenticated>
          <Authenticated>
            <p className="max-w-measure type-body-sm text-text-2">
              To connect an agent, open the note you want it to work on and choose{" "}
              <span className="text-text-1">Agent access</span>. Monotes gives you one message to paste into your agent,
              then shows when it has connected.
            </p>
            <Frame aria-labelledby="your-agents">
              <FrameHeader>
                <FrameTitle id="your-agents">Your agents</FrameTitle>
              </FrameHeader>
              <FrameBody padding="none">
                <Connections />
              </FrameBody>
            </Frame>
            <Collapsible>
              <CollapsibleTrigger size="sm">Create a key manually</CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pt-3">
                  <CreateAgentKey />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Authenticated>
        </section>
      </main>
    </div>
  );
}
