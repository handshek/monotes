"use client";

import Link from "next/link";
import { useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useLiveQuery } from "dexie-react-hooks";
import Navbar from "@/app/(notes)/navbar";
import { getDB } from "@/lib/local-db";
import { noteTitle } from "../../../../convex/lib/collabCore";
import { AgentAccessExplanation } from "@/components/agents/agent-access-dialog";
import { CreateAgentKey } from "@/components/agents/agent-setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATE_LABELS = {
  connected: "Connected",
  waiting: "Code accepted, hasn’t read a note yet",
  used: "Set up manually",
  unused: "Set up manually, never used — its key can’t be shown again; connect it again from a note",
} as const;

function Connections() {
  const connections = useQuery(api.agents.listConnections);
  const setGrant = useMutation(api.agents.setGrant);
  const revoke = useMutation(api.agents.revokeConnection);
  const rename = useMutation(api.agents.renameConnection);
  const [revoking, setRevoking] = useState<{ id: Id<"agentConnections">; name: string } | null>(null);
  const [editing, setEditing] = useState<{ id: Id<"agentConnections">; name: string } | null>(null);
  // Titles come from this device's copies; the server list holds only note ids.
  const titles = useLiveQuery(async () => {
    const ids = [...new Set((connections ?? []).flatMap((connection) => connection.notes.map((note) => note.noteId)))];
    const rows = await getDB().notes.bulkGet(ids);
    return new Map(rows.flatMap((row) => (row ? [[row.id, noteTitle(row.content)] as const] : [])));
  }, [connections]);

  if (connections === undefined) return null;
  return (
    <>
      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents connected yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Connected agents">
          {connections.map((connection) => (
            <li key={connection.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {editing?.id === connection.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const result = await rename({ connectionId: connection.id, name: editing.name });
                      if (result.status === "ok") setEditing(null);
                      else toast.error("Use a name of 1–60 characters.");
                    }}
                  >
                    <Input
                      aria-label="Agent name"
                      value={editing.name}
                      maxLength={60}
                      onChange={(event) => setEditing({ id: connection.id, name: event.target.value })}
                    />
                    <Button size="sm" type="submit">Save</Button>
                  </form>
                ) : (
                  <div>
                    <div className="font-medium">{connection.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {STATE_LABELS[connection.state]} · added {new Date(connection.createdAt).toLocaleDateString()}
                      {connection.lastUsedAt ? ` · last used ${new Date(connection.lastUsedAt).toLocaleString()}` : ""}
                      {connection.credentialFile ? ` · access file ${connection.credentialFile}` : ""}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: connection.id, name: connection.name })}>
                    Rename
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRevoking({ id: connection.id, name: connection.name })}>
                    Revoke key
                  </Button>
                </div>
              </div>
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium">Notes this agent can use</div>
                {connection.notes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None. Allow it on a note from that note’s Agent access menu.</p>
                ) : (
                  <ul className="space-y-1">
                    {connection.notes.map((note) => (
                      <li key={note.noteId} className="flex items-center justify-between gap-2">
                        <Link href={`/${note.noteId}`} className="truncate underline">
                          {titles?.get(note.noteId) ?? note.noteId}
                        </Link>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {note.access === "edit" ? "Can edit" : "Can read"}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const result = await setGrant({ noteId: note.noteId, connectionId: connection.id, access: "none" });
                              if (result.status !== "ok") toast.error("Couldn’t remove access.");
                            }}
                          >
                            Remove access
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {connection.moreNotes && (
                  <p className="mt-1 text-xs text-muted-foreground">And more notes not listed here.</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The key stops working on its next request and loses access to every note. Its past edits stay in each
              note’s history. This can’t be undone; create a new key if you need one again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!revoking) return;
                const result = await revoke({ connectionId: revoking.id });
                if (result.status === "ok") toast.success("Key revoked");
                else toast.error("Couldn’t revoke the key.");
                setRevoking(null);
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AgentAccessPage() {
  return (
    <div className="bg-background p-2">
      <Navbar />
      <main className="flex">
        <section className="flex-1 md:max-w-3xl mx-auto py-16 px-4 space-y-6">
          <h1 className="text-2xl font-semibold">Agent access</h1>
          <AgentAccessExplanation />
          <AuthLoading>{null}</AuthLoading>
          <Unauthenticated>
            <p className="text-sm">
              <Link href="/signin" className="underline">Sign in</Link> to manage agent keys.
            </p>
          </Unauthenticated>
          <Authenticated>
            <p className="rounded-md border p-3 text-sm">
              To connect an agent, open the note you want it to work on and choose <strong>Agent access</strong>. Monotes
              gives you one message to paste into your agent, then shows when it has connected.
            </p>
            <h2 className="text-lg font-medium">Your agents</h2>
            <Connections />
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Create a key manually instead</summary>
              <div className="mt-3">
                <CreateAgentKey />
              </div>
            </details>
          </Authenticated>
        </section>
      </main>
    </div>
  );
}
