// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeSet, EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { collab } from "@codemirror/collab";
import {
  CLIENT_EXTENDED_BATCH_BYTES,
  CLIENT_PUSH_BATCH_BYTES,
  MAX_NOTE_CHARS,
  MAX_PUSH_UPDATES,
  MAX_STEP_BATCH_BYTES,
  composeDescs,
  rebaseSubmitted,
  serializeChanges,
  storedUpdateBytes,
  toText,
  type AcceptedUpdate,
} from "../../convex/lib/collabCore";
import { getDB, type CollabClientRecord } from "../../src/lib/local-db";
import { agentMarks } from "../../src/lib/collab/agent-marks";
import { CollabSession, type SessionStatus, type SessionTiming } from "../../src/lib/collab/session";
import type { CollabTransport, HeadResult, PushArgs, PushResult } from "../../src/lib/collab/transport";

const NOTE = "Note000001";
const EPOCH = "0f6b6c1e-1a2b-4c3d-8e9f-001122334455";

/* In-memory authority using the server's rebase rule. */
class FakeServer implements CollabTransport {
  doc: Text;
  updates: (AcceptedUpdate & { author: "user" | "agent" })[] = [];
  lastSeq = new Map<string, number>();
  pushes: PushArgs[] = [];
  online = true;
  loseNextAck = false;
  deleted = false;
  pushDelayMs = 0;
  /* Number of upcoming pushes that throw instead of answering. */
  throwNext = 0;
  batchBytes: number[] = [];
  beforePush: ((args: PushArgs) => Promise<void> | void) | null = null;
  private watchers = new Set<(head: HeadResult) => void>();
  private waiting: (() => void)[] = [];

  constructor(text: string) {
    this.doc = toText(text);
  }
  get version() {
    return this.updates.length;
  }
  text() {
    return this.doc.toString();
  }
  private async connection() {
    while (!this.online) await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  setOnline(online: boolean) {
    this.online = online;
    if (online) for (const resolve of this.waiting.splice(0)) resolve();
  }
  private notify() {
    const head: HeadResult = this.deleted
      ? { status: "deleted" }
      : { status: "ok", epoch: EPOCH, version: this.version };
    for (const watcher of this.watchers) watcher(head);
  }
  async snapshot() {
    await this.connection();
    if (this.deleted) return { status: "deleted" as const };
    return { status: "ok" as const, epoch: EPOCH, version: this.version, text: this.text() };
  }
  async stepsSince(_noteId: string, _epoch: string, since: number) {
    await this.connection();
    if (this.deleted) return { status: "deleted" as const };
    return {
      status: "ok" as const,
      version: this.version,
      batches: this.updates.slice(since).map((update) => ({
        fromVersion: update.version - 1,
        toVersion: update.version,
        clientId: update.clientId,
        author: update.author === "agent" ? { kind: "agent" as const, name: "Claude Code" } : { kind: "user" as const },
        updates: [JSON.stringify(update.changes.toJSON())],
        createdAt: 0,
      })),
    };
  }
  async push(args: PushArgs): Promise<PushResult> {
    this.pushes.push(args);
    await this.beforePush?.(args);
    if (this.pushDelayMs) await new Promise((resolve) => setTimeout(resolve, this.pushDelayMs));
    await this.connection();
    if (this.throwNext > 0) {
      this.throwNext--;
      throw new Error("[CONVEX M(collab:pushUpdates)] Server Error");
    }
    if (this.deleted) return { status: "error", code: "deleted" };
    const over = this.updates.slice(args.baseVersion);
    const submitted = args.updates.map((update) => ({ seq: update.seq, changes: ChangeSet.fromJSON(JSON.parse(update.changes)) }));
    const baseLength = composeDescs(over)?.length ?? this.doc.length;
    const result = rebaseSubmitted(args.clientId, baseLength, submitted, over, this.lastSeq.get(args.clientId) ?? 0);
    if (!result.ok) return { status: "error", code: result.code };
    // The server's note-length rule: only the batch's end result must fit.
    const finalLength = result.accepted.reduce((doc, update) => update.changes.apply(doc), this.doc).length;
    if (finalLength > MAX_NOTE_CHARS) return { status: "error", code: "note_too_long" };
    // The server's stored-document rule.
    const bytes = result.accepted.reduce((total, update) => total + storedUpdateBytes(serializeChanges(update.changes)), 128);
    if (bytes > MAX_STEP_BATCH_BYTES) {
      return { status: "error", code: result.accepted.length > 1 ? "batch_too_large" : "too_large" };
    }
    this.batchBytes.push(args.updates.reduce((total, update) => total + storedUpdateBytes(update.changes), 0));
    for (const update of result.accepted) this.accept(args.clientId, update.seq, update.changes, "user");
    if (this.loseNextAck) {
      this.loseNextAck = false;
      throw new Error("connection lost before the acknowledgement");
    }
    return { status: "ok", version: this.version };
  }
  accept(clientId: string, seq: number, changes: ChangeSet, author: "user" | "agent") {
    this.doc = changes.apply(this.doc);
    this.updates.push({ version: this.updates.length + 1, clientId, seq, changes, author });
    if (author === "user") this.lastSeq.set(clientId, seq);
    queueMicrotask(() => this.notify());
  }
  agentInsert(at: number, text: string) {
    this.accept("agent:1", 0, ChangeSet.of({ from: at, insert: text }, this.doc.length), "agent");
  }
  watchHead(_noteId: string, onHead: (head: HeadResult) => void) {
    this.watchers.add(onHead);
    queueMicrotask(() => this.notify());
    return () => this.watchers.delete(onHead);
  }
}

/* Minimal Web Locks stand-in: exclusive, ifAvailable only. */
class FakeLocks {
  held = new Set<string>();
  beforeGrant: ((name: string) => Promise<void> | void) | null = null;
  async request(name: string, _options: { ifAvailable: boolean }, callback: (lock: { name: string } | null) => Promise<void>) {
    await this.beforeGrant?.(name);
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

let locks: FakeLocks;
const views: EditorView[] = [];
const sessions: CollabSession[] = [];

function installLocks(available: boolean) {
  locks = new FakeLocks();
  Object.defineProperty(navigator, "locks", { configurable: true, value: available ? locks : undefined });
}

beforeEach(async () => {
  installLocks(true);
  sessionStorage.clear();
  const db = getDB();
  await db.open();
  await Promise.all([db.notes.clear(), db.collabClients.clear(), db.recoveries.clear()]);
  await db.notes.put({ id: NOTE, content: "", updatedAt: 1, cloudStatus: "synced", collab: { epoch: EPOCH } });
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const view of views.splice(0)) view.destroy();
});

async function openEditor(server: FakeServer, timing: Partial<SessionTiming> = {}) {
  const statuses: SessionStatus[] = [];
  const agentEdits: string[] = [];
  const resets: number[] = [];
  const opened = await CollabSession.open(NOTE, EPOCH, server, {
    onStatus: (status) => statuses.push(status),
    onAgentEdit: (name) => agentEdits.push(name),
    onReset: () => resets.push(1),
  }, timing);
  if (opened.kind !== "ready") throw new Error(`open failed: ${opened.kind}`);
  const session = opened.session;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: opened.doc,
      extensions: [
        collab({ startVersion: opened.version, clientID: opened.clientId }),
        agentMarks(),
        EditorView.updateListener.of((update) => session.handleUpdate(update)),
      ],
    }),
  });
  views.push(view);
  sessions.push(session);
  session.attach(view);
  return { session, view, statuses, agentEdits, resets, clientId: opened.clientId };
}

function type(view: EditorView, text: string, at = view.state.doc.length) {
  view.dispatch({ changes: { from: at, insert: text }, userEvent: "input.type" });
}

/* Simulate closing the tab: stop the session and release its lock without a final send. */
function closeTab(editor: { session: CollabSession; view: EditorView }) {
  editor.session.dispose();
  editor.view.destroy();
  sessions.splice(sessions.indexOf(editor.session), 1);
  views.splice(views.indexOf(editor.view), 1);
}

const settle = () => vi.waitFor(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe("collaboration session", () => {
  it("stores updates on the device before sending them", async () => {
    const server = new FakeServer("start");
    const storedAtSend: (CollabClientRecord | undefined)[] = [];
    server.beforePush = async (args) => {
      storedAtSend.push(await getDB().collabClients.get([NOTE, args.clientId]));
    };
    const editor = await openEditor(server);
    type(editor.view, " typed");
    await vi.waitFor(() => expect(server.text()).toBe("start typed"));
    const sent = server.pushes[0];
    const stored = storedAtSend[0];
    expect(stored?.unconfirmed.map((update) => update.seq)).toEqual(expect.arrayContaining(sent.updates.map((update) => update.seq)));
    await vi.waitFor(async () => expect((await getDB().notes.get(NOTE))?.content).toBe("start typed"));
  });

  it("applies text once when an acknowledgement is lost", async () => {
    const server = new FakeServer("a");
    server.loseNextAck = true;
    const editor = await openEditor(server);
    type(editor.view, "b");
    await vi.waitFor(() => expect(server.pushes.length).toBeGreaterThan(0));
    // The client retries after the failure; the server drops what it already has.
    await vi.waitFor(() => expect(editor.session.pendingCount()).toBe(0), { timeout: 4000 });
    expect(server.text()).toBe("ab");
    expect(editor.view.state.doc.toString()).toBe("ab");
  });

  it("keeps an agent edit and unsent typing together, highlighting the agent text", async () => {
    const server = new FakeServer("one two");
    const editor = await openEditor(server);
    server.setOnline(false);
    type(editor.view, " three");
    server.agentInsert(0, "ZERO ");
    server.setOnline(true);
    await vi.waitFor(() => expect(editor.session.pendingCount()).toBe(0));
    expect(server.text()).toBe("ZERO one two three");
    expect(editor.view.state.doc.toString()).toBe("ZERO one two three");
    expect(editor.agentEdits).toContain("Claude Code");
    await vi.waitFor(() => expect(editor.view.contentDOM.querySelector(".cm-agent-edit")?.textContent).toBe("ZERO "));
    expect(editor.view.contentDOM.querySelector(".cm-agent-edit")?.getAttribute("title")).toBe("Edited by Claude Code");
  });

  it("resumes the same queue after a reload while offline", async () => {
    const server = new FakeServer("draft");
    const first = await openEditor(server);
    await settle();
    server.setOnline(false);
    type(first.view, " offline words");
    await vi.waitFor(async () => {
      const row = await getDB().collabClients.get([NOTE, first.clientId]);
      expect(row?.unconfirmed.length).toBe(1);
    });
    closeTab(first);
    server.setOnline(true);
    const second = await openEditor(server);
    expect(second.clientId).toBe(first.clientId);
    expect(second.view.state.doc.toString()).toBe("draft offline words");
    await vi.waitFor(() => expect(second.session.pendingCount()).toBe(0));
    expect(server.text()).toBe("draft offline words");
  });

  it("re-applies typing that only reached the session draft before a reload", async () => {
    const server = new FakeServer("base");
    const first = await openEditor(server);
    await vi.waitFor(() => expect(first.statuses.at(-1)?.connection).toBe("live"));
    closeTab(first);
    sessionStorage.setItem(
      `monotes-collab-draft:${NOTE}:${first.clientId}`,
      JSON.stringify({ epoch: EPOCH, version: 0, text: "base plus last keystrokes" }),
    );
    const second = await openEditor(server);
    expect(second.view.state.doc.toString()).toBe("base plus last keystrokes");
    await vi.waitFor(() => expect(server.text()).toBe("base plus last keystrokes"));
  });

  it("sends a closed tab's queue under that tab's lock, using the row as it is once locked", async () => {
    const server = new FakeServer("x");
    const orphanId = "c_closedtab0001";
    const stale: CollabClientRecord = {
      noteId: NOTE, clientId: orphanId, epoch: EPOCH, version: 0, text: "x", confirmedSeq: 0,
      unconfirmed: [{ seq: 1, changes: JSON.stringify(ChangeSet.of({ from: 1, insert: "1" }, 1).toJSON()) }],
      updatedAt: 1,
    };
    await getDB().collabClients.put(stale);
    // The owner saves newer typing just before its lock becomes free.
    locks.beforeGrant = async (name) => {
      if (!name.endsWith(orphanId)) return;
      locks.beforeGrant = null;
      await getDB().collabClients.put({
        ...stale,
        unconfirmed: [
          ...stale.unconfirmed,
          { seq: 2, changes: JSON.stringify(ChangeSet.of({ from: 2, insert: "2" }, 2).toJSON()) },
        ],
      });
    };
    await openEditor(server);
    await vi.waitFor(() => expect(server.text()).toBe("x12"));
    await vi.waitFor(async () => expect(await getDB().collabClients.get([NOTE, orphanId])).toBeUndefined());
  });

  it("keeps an oversized orphan queue whole for review instead of replaying part of it", async () => {
    const server = new FakeServer("");
    const orphanId = "c_bigqueue0001";
    let doc = Text.empty;
    const unconfirmed = [];
    for (let seq = 1; seq <= MAX_PUSH_UPDATES + 5; seq++) {
      const changes = ChangeSet.of({ from: doc.length, insert: "a" }, doc.length);
      unconfirmed.push({ seq, changes: JSON.stringify(changes.toJSON()) });
      doc = changes.apply(doc);
    }
    await getDB().collabClients.put({ noteId: NOTE, clientId: orphanId, epoch: EPOCH, version: 0, text: "", confirmedSeq: 0, unconfirmed, updatedAt: 1 });
    await openEditor(server);
    await vi.waitFor(async () => {
      const kept = await getDB().recoveries.toArray();
      expect(kept.map((item) => item.text)).toContain("a".repeat(MAX_PUSH_UPDATES + 5));
    });
    expect(server.pushes.filter((push) => push.clientId === orphanId)).toHaveLength(0);
    expect(server.text()).toBe("");
  });

  it("keeps an orphan queue that is too large by bytes for one request whole for review", async () => {
    const server = new FakeServer("");
    const orphanId = "c_bigbytes0001";
    let doc = Text.empty;
    const unconfirmed = [];
    for (let seq = 1; seq <= 8; seq++) {
      const changes = ChangeSet.of({ from: doc.length, insert: "字".repeat(30_000) }, doc.length);
      unconfirmed.push({ seq, changes: JSON.stringify(changes.toJSON()) });
      doc = changes.apply(doc);
    }
    await getDB().collabClients.put({ noteId: NOTE, clientId: orphanId, epoch: EPOCH, version: 0, text: "", confirmedSeq: 0, unconfirmed, updatedAt: 1 });
    await openEditor(server);
    await vi.waitFor(async () => {
      const kept = await getDB().recoveries.toArray();
      expect(kept.map((item) => item.text)).toContain(doc.toString());
    });
    expect(server.pushes.filter((push) => push.clientId === orphanId)).toHaveLength(0);
  });

  it("offers another window's queue for review when Web Locks are unavailable", async () => {
    installLocks(false);
    const server = new FakeServer("x");
    const otherId = "c_maybealive01";
    await getDB().collabClients.put({
      noteId: NOTE, clientId: otherId, epoch: EPOCH, version: 0, text: "x", confirmedSeq: 0,
      unconfirmed: [{ seq: 1, changes: JSON.stringify(ChangeSet.of({ from: 1, insert: "!" }, 1).toJSON()) }],
      updatedAt: 1,
    });
    await openEditor(server);
    await vi.waitFor(async () => expect((await getDB().recoveries.toArray()).map((item) => item.text)).toContain("x!"));
    await settle();
    expect(server.pushes.filter((push) => push.clientId === otherId)).toHaveLength(0);
    expect(await getDB().collabClients.get([NOTE, otherId])).toBeDefined();
  });

  it("does not send when the queue can't be stored, and reports it", async () => {
    const server = new FakeServer("safe");
    const editor = await openEditor(server);
    await settle();
    const put = vi.spyOn(getDB().collabClients, "put").mockRejectedValue(new Error("quota"));
    const before = server.pushes.length;
    type(editor.view, " unsaved");
    await vi.waitFor(() => expect(editor.statuses.at(-1)?.storageError).toBe(true));
    await settle();
    expect(server.pushes.length).toBe(before);
    put.mockRestore();
  });

  it("keeps unsent text when the note is deleted elsewhere", async () => {
    const server = new FakeServer("shared");
    const editor = await openEditor(server);
    await settle();
    server.setOnline(false);
    type(editor.view, " unsent");
    server.deleted = true;
    server.setOnline(true);
    await vi.waitFor(async () => expect((await getDB().recoveries.toArray()).map((item) => item.reason)).toContain("deleted"));
    expect(editor.statuses.at(-1)?.connection).toBe("deleted");
  });

  it("flush settles typing with the server, so a restore preview can start from the confirmed version", async () => {
    const server = new FakeServer("base");
    const editor = await openEditor(server);
    type(editor.view, " typed");
    const result = await editor.session.flush();
    expect(result).toEqual({ savedLocally: true, pending: 0, problem: null });
    expect(server.text()).toBe("base typed");
    expect(editor.session.syncedVersion()).toBe(server.version);
  });

  it("flush waits for a push already in flight", async () => {
    const server = new FakeServer("x");
    server.pushDelayMs = 300;
    const editor = await openEditor(server);
    type(editor.view, "y");
    await vi.waitFor(() => expect(server.pushes.length).toBe(1));
    const result = await editor.session.flush();
    expect(result.pending).toBe(0);
    expect(server.text()).toBe("xy");
  });

  it("flush reports the local save promptly while offline", async () => {
    const server = new FakeServer("x");
    const editor = await openEditor(server);
    await settle();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
    try {
      server.setOnline(false);
      type(editor.view, " offline");
      const started = Date.now();
      const result = await editor.session.flush();
      expect(Date.now() - started).toBeLessThan(500);
      expect(result).toEqual({ savedLocally: true, pending: 1, problem: null });
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      server.setOnline(true);
    }
  });

  it("flush stops waiting for a server that never answers, and the request still completes once", async () => {
    const server = new FakeServer("x");
    const editor = await openEditor(server, { flushSettleMs: 200 });
    await settle();
    server.setOnline(false);
    type(editor.view, "z");
    const started = Date.now();
    const result = await editor.session.flush();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.pending).toBe(1);
    server.setOnline(true);
    await vi.waitFor(() => expect(editor.session.pendingCount()).toBe(0));
    expect(server.text()).toBe("xz");
  });

  it("takes a fresh identity when its stored queue is unreadable, keeping the old text", async () => {
    const server = new FakeServer("start");
    const first = await openEditor(server);
    type(first.view, " sent");
    await vi.waitFor(() => expect(server.text()).toBe("start sent"));
    closeTab(first);
    // Corrupt the stored queue: a sequence gap the session can't trust.
    const row = await getDB().collabClients.get([NOTE, first.clientId]);
    await getDB().collabClients.put({
      ...row!,
      unconfirmed: [{ seq: row!.confirmedSeq + 5, changes: JSON.stringify(ChangeSet.of({ from: 0, insert: "lost? " }, row!.text.length).toJSON()) }],
    });
    const second = await openEditor(server);
    expect(second.clientId).not.toBe(first.clientId);
    type(second.view, " after");
    await vi.waitFor(() => expect(server.text()).toBe("start sent after"));
    expect((await getDB().recoveries.toArray()).map((item) => item.text)).toContain("lost? start sent");
  });

  it("keeps exactly one copy of unsent text when deletion is reported several ways", async () => {
    const server = new FakeServer("shared");
    const editor = await openEditor(server);
    await settle();
    server.setOnline(false);
    type(editor.view, " unsent");
    server.deleted = true;
    server.setOnline(true);
    await vi.waitFor(() => expect(editor.statuses.at(-1)?.connection).toBe("deleted"));
    await editor.session.flush();
    await settle();
    const kept = (await getDB().recoveries.toArray()).filter((item) => item.reason === "deleted");
    expect(kept).toHaveLength(1);
  });

  it("sends a large multibyte queue in batches that fit the stored-document limit", async () => {
    const server = new FakeServer("");
    const editor = await openEditor(server);
    await settle();
    server.setOnline(false);
    const chunk = "語".repeat(30_000);
    for (let i = 0; i < 6; i++) type(editor.view, chunk);
    server.setOnline(true);
    await vi.waitFor(() => expect(editor.session.pendingCount()).toBe(0), { timeout: 5000 });
    expect(server.text()).toBe(chunk.repeat(6));
    expect(server.batchBytes.length).toBeGreaterThan(1);
    for (const bytes of server.batchBytes) expect(bytes).toBeLessThanOrEqual(CLIENT_PUSH_BATCH_BYTES);
  });

  it("retries a transient server failure", async () => {
    const transient = new FakeServer("a");
    transient.throwNext = 1;
    const recovering = await openEditor(transient, { retryBaseMs: 20 });
    type(recovering.view, "b");
    await vi.waitFor(() => expect(recovering.session.pendingCount()).toBe(0));
    expect(transient.text()).toBe("ab");
    expect(recovering.statuses.at(-1)?.problem).toBeNull();
  });

  it("stops after repeated server failures, keeps the text, and sends again when asked", async () => {
    const failing = new FakeServer("c");
    failing.throwNext = 100;
    const editor = await openEditor(failing, { retryBaseMs: 20 });
    type(editor.view, "d");
    await vi.waitFor(() => expect(editor.statuses.at(-1)?.problem).toBe("rejected"));
    const attempts = failing.pushes.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(failing.pushes.length).toBe(attempts);
    expect((await getDB().recoveries.toArray()).some((item) => item.reason === "unsent" && item.text === "cd")).toBe(true);
    failing.throwNext = 0;
    editor.session.retrySending();
    await vi.waitFor(() => expect(failing.text()).toBe("cd"));
    expect(editor.statuses.at(-1)?.problem).toBeNull();
  });

  it("waits briefly for its own previous lock during a reload instead of taking a new identity", async () => {
    const server = new FakeServer("x");
    const first = await openEditor(server);
    await settle();
    closeTab(first);
    await settle();
    const name = `monotes-collab:${NOTE}:${first.clientId}`;
    locks.held.add(name);
    setTimeout(() => locks.held.delete(name), 250);
    const second = await openEditor(server);
    expect(second.clientId).toBe(first.clientId);
  });

  it("keeps typing saved under a previous identity in this tab", async () => {
    const server = new FakeServer("base");
    sessionStorage.setItem(
      `monotes-collab-draft:${NOTE}:c_previousid01`,
      JSON.stringify({ epoch: EPOCH, version: 0, text: "base and lost typing" }),
    );
    await openEditor(server);
    await vi.waitFor(async () => {
      const kept = await getDB().recoveries.toArray();
      expect(kept.map((item) => [item.reason, item.text])).toContainEqual(["unsaved_typing", "base and lost typing"]);
    });
    expect(sessionStorage.getItem(`monotes-collab-draft:${NOTE}:c_previousid01`)).toBeNull();
  });

  describe("over the length limit", () => {
    const problem = (editor: Awaited<ReturnType<typeof openEditor>>) => editor.statuses.at(-1)?.problem ?? null;

    it("waits after an over-long ASCII paste and resumes by itself after undo", async () => {
      const server = new FakeServer("start");
      const editor = await openEditor(server);
      await settle();
      type(editor.view, "x".repeat(MAX_NOTE_CHARS));
      await vi.waitFor(() => expect(problem(editor)).toBe("note_too_long"));
      expect(server.text()).toBe("start");
      // Undo the paste.
      editor.view.dispatch({ changes: { from: 5, to: 5 + MAX_NOTE_CHARS } });
      type(editor.view, " then typing");
      await vi.waitFor(() => expect(editor.session.pendingCount()).toBe(0));
      expect(server.text()).toBe("start then typing");
      expect(problem(editor)).toBeNull();
    });

    it("sends a CJK paste larger than an ordinary batch together with the edit that shortens it", async () => {
      const server = new FakeServer("前");
      const editor = await openEditor(server);
      await settle();
      const paste = "語".repeat(MAX_NOTE_CHARS + 5_000);
      type(editor.view, paste);
      await vi.waitFor(() => expect(problem(editor)).toBe("note_too_long"));
      // Shorten: keep 1,000 of the pasted characters.
      editor.view.dispatch({ changes: { from: 1 + 1_000, to: 1 + paste.length } });
      await vi.waitFor(() => expect(editor.session.pendingCount()).toBe(0));
      expect(server.text()).toBe("前" + "語".repeat(1_000));
      expect(server.batchBytes.at(-1)).toBeGreaterThan(CLIENT_PUSH_BATCH_BYTES);
      expect(server.batchBytes.at(-1)).toBeLessThanOrEqual(CLIENT_EXTENDED_BATCH_BYTES);
      type(editor.view, "後");
      await vi.waitFor(() => expect(server.text()).toBe("前" + "語".repeat(1_000) + "後"));
      expect(problem(editor)).toBeNull();
    });

    it("waits when other people's text makes the note too long, and resumes once it shrinks", async () => {
      const server = new FakeServer("");
      const editor = await openEditor(server);
      await settle();
      server.setOnline(false);
      type(editor.view, "m".repeat(150_000));
      server.agentInsert(0, "a".repeat(60_000));
      server.setOnline(true);
      await vi.waitFor(() => expect(problem(editor)).toBe("note_too_long"));
      expect(server.text()).toBe("a".repeat(60_000));
      // The other text is removed on the server; the waiting queue goes through.
      server.accept("agent:1", 0, ChangeSet.of({ from: 0, to: 60_000 }, server.doc.length), "agent");
      await vi.waitFor(() => expect(editor.session.pendingCount()).toBe(0));
      expect(server.text()).toBe("m".repeat(150_000));
      expect(problem(editor)).toBeNull();
    });

    it("keeps a single unsendable change for review and starts again on request", async () => {
      const server = new FakeServer("ok");
      const editor = await openEditor(server);
      await settle();
      // Control characters serialize to six bytes each: too big for any stored batch.
      type(editor.view, "\u0001".repeat(150_000));
      await vi.waitFor(() => expect(problem(editor)).toBe("too_large"));
      expect(server.text()).toBe("ok");
      expect((await getDB().recoveries.toArray()).some((item) => item.reason === "unsent")).toBe(true);
      editor.session.keepTextAndRestart();
      await vi.waitFor(() => expect(editor.resets).toHaveLength(1));
    });

    it("says so when the note only fits again past what one request can carry", async () => {
      const server = new FakeServer("");
      const editor = await openEditor(server);
      await settle();
      type(editor.view, "語".repeat(MAX_NOTE_CHARS + 5_000));
      type(editor.view, "字".repeat(100_000));
      editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: "kept text" } });
      await vi.waitFor(() => expect(problem(editor)).toBe("queue_too_large"));
      expect(server.text()).toBe("");
      const kept = await getDB().recoveries.toArray();
      expect(kept.map((item) => [item.reason, item.text])).toContainEqual(["unsent", "kept text"]);
    });
  });
});
