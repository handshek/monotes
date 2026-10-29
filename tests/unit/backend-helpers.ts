/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ChangeSet, type ChangeSpec } from "@codemirror/state";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { serializeChanges, toText } from "../../convex/lib/collabCore";

export const modules = import.meta.glob("../../convex/**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

export type Backend = ReturnType<typeof setup>;

export async function signIn(t: Backend, name = "Owner") {
  const userId = await t.run((ctx) => ctx.db.insert("users", { name }));
  return { userId, as: t.withIdentity({ subject: `${userId}|session` }) };
}

export type Owner = Awaited<ReturnType<typeof signIn>>["as"];

/* A browser-like collaboration client that tracks its confirmed version and sequence numbers. */
export class TestClient {
  version = 0;
  seq = 0;
  text: string;
  constructor(
    readonly owner: Owner,
    readonly noteId: string,
    readonly epoch: string,
    readonly clientId: string,
    text: string,
    version = 0,
  ) {
    this.text = text;
    this.version = version;
  }
  change(spec: ChangeSpec) {
    const changes = ChangeSet.of(spec, toText(this.text).length);
    this.seq++;
    return { seq: this.seq, changes: serializeChanges(changes), apply: () => changes.apply(toText(this.text)).toString() };
  }
  async push(updates: { seq: number; changes: string }[], baseVersion = this.version) {
    return this.owner.mutation(api.collab.pushUpdates, {
      noteId: this.noteId,
      epoch: this.epoch,
      clientId: this.clientId,
      baseVersion,
      updates: updates.map(({ seq, changes }) => ({ seq, changes })),
    });
  }
  /* Pull the server's accepted text and version, as the browser does after receiving steps. */
  async sync() {
    const snapshot = await this.owner.query(api.collab.snapshot, { noteId: this.noteId });
    if (snapshot.status !== "ok") throw new Error(snapshot.status);
    this.text = snapshot.text;
    this.version = snapshot.version;
  }
}

export async function enableNote(owner: Owner, noteId: string, text: string) {
  const result = await owner.mutation(api.collab.enable, { noteId, localText: text });
  if (result.status !== "enabled") throw new Error(`enable failed: ${result.status}`);
  return result;
}

export async function createAgent(owner: Owner, name = "Claude Code") {
  const result = await owner.action(api.agents.createConnection, { name });
  if (result.status !== "created") throw new Error(result.status);
  return result;
}

export function agentFetch(t: Backend, token: string) {
  return async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await t.fetch(`/agent/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json: unknown = await response.json();
    return { status: response.status, json, headers: response.headers };
  };
}
