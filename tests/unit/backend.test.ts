import { describe, expect, it } from "vitest";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { CHECKPOINT_INTERVAL, MAX_NOTE_CHARS } from "../../convex/lib/collabCore";
import {
  TestClient,
  agentFetch,
  createAgent,
  enableNote,
  setup,
  signIn,
  type Backend,
} from "./backend-helpers";

const NOTE = "Note000001";
const CLIENT = "c_tab_one_0001";
const OTHER_CLIENT = "c_tab_two_0002";

const noteBody = z.object({
  note: z.object({ id: z.string(), version: z.string(), content: z.string(), access: z.string() }),
});
const errorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const errorCode = (json: unknown) => errorBody.parse(json).error.code;

async function contentOf(t: Backend, noteId = NOTE) {
  return t.run(async (ctx) => {
    const note = await ctx.db.query("notes").filter((q) => q.eq(q.field("noteId"), noteId)).first();
    return note?.content ?? null;
  });
}

async function connectedNote(text: string) {
  const t = setup();
  const { as: owner } = await signIn(t);
  const enabled = await enableNote(owner, NOTE, text);
  const agent = await createAgent(owner);
  const call = agentFetch(t, agent.token);
  return { t, owner, enabled, agent, call };
}

describe("connecting a note", () => {
  it("asks for a choice when the cloud copy differs and keeps the unchosen text", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    await owner.mutation(api.notes.syncNote, { noteId: NOTE, content: "cloud text", updatedAt: 1 });
    const first = await owner.mutation(api.collab.enable, { noteId: NOTE, localText: "device text" });
    expect(first).toMatchObject({ status: "needs_choice", cloudText: "cloud text" });
    if (first.status !== "needs_choice") throw new Error("expected choice");

    const stale = await owner.mutation(api.collab.enable, {
      noteId: NOTE,
      localText: "device text",
      choice: "local",
      expectedCloudUpdatedAt: first.cloudUpdatedAt - 1,
    });
    expect(stale.status).toBe("cloud_changed");

    const chosen = await owner.mutation(api.collab.enable, {
      noteId: NOTE,
      localText: "device text",
      choice: "cloud",
      expectedCloudUpdatedAt: first.cloudUpdatedAt,
    });
    expect(chosen).toMatchObject({ status: "enabled", text: "cloud text" });
    const checkpoints = await owner.query(api.collab.checkpoints, { noteId: NOTE });
    const unchosen = checkpoints.find((checkpoint) => checkpoint.reason === "unchosen_copy");
    expect(unchosen).toBeDefined();
    const saved = await owner.query(api.collab.checkpointText, { noteId: NOTE, checkpointId: unchosen!.id });
    expect(saved?.text).toBe("device text");
  });

  it("rejects legacy whole-note writes once connected, including after deletion", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    await enableNote(owner, NOTE, "connected");
    await expect(
      owner.mutation(api.notes.syncNote, { noteId: NOTE, content: "old tab upload", updatedAt: Date.now() }),
    ).rejects.toThrow(/note_is_collaborative/);
    await expect(
      owner.mutation(api.notes.updateNote, { noteId: NOTE, content: "old tab upload", updatedAt: Date.now() }),
    ).rejects.toThrow(/note_is_collaborative/);
    await owner.mutation(api.collab.deleteCloudNote, { noteId: NOTE });
    await expect(
      owner.mutation(api.notes.syncNote, { noteId: NOTE, content: "resurrect", updatedAt: Date.now() }),
    ).rejects.toThrow(/note_is_collaborative/);
    expect(await owner.query(api.collab.head, { noteId: NOTE })).toEqual({ status: "deleted" });
  });

  it("does not expose another person's note", async () => {
    const t = setup();
    const { as: owner } = await signIn(t, "Owner");
    const { as: stranger } = await signIn(t, "Stranger");
    await enableNote(owner, NOTE, "private");
    expect(await stranger.query(api.collab.snapshot, { noteId: NOTE })).toEqual({ status: "missing" });
    expect(await t.query(api.collab.snapshot, { noteId: NOTE })).toEqual({ status: "signed_out" });
  });
});

describe("human updates", () => {
  it("does not duplicate text when a batch is resent after a lost acknowledgement", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    const { epoch } = await enableNote(owner, NOTE, "hello");
    const client = new TestClient(owner, NOTE, epoch, CLIENT, "hello");
    const a = client.change({ from: 5, insert: " world" });
    expect(await client.push([a])).toEqual({ status: "ok", version: 1 });
    // Acknowledgement lost: the same batch plus a new update arrives from the old base.
    const textAfterA = a.apply();
    const b = { seq: 2, changes: new TestClient(owner, NOTE, epoch, CLIENT, textAfterA).change({ from: textAfterA.length, insert: "!" }).changes };
    expect(await client.push([a, b], 0)).toEqual({ status: "ok", version: 2 });
    expect(await client.push([a, b], 0)).toEqual({ status: "ok", version: 2 });
    expect(await contentOf(t)).toBe("hello world!");
  });

  it("rebases a stale tab over another tab's accepted typing", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    const { epoch } = await enableNote(owner, NOTE, "middle");
    const one = new TestClient(owner, NOTE, epoch, CLIENT, "middle");
    const two = new TestClient(owner, NOTE, epoch, OTHER_CLIENT, "middle");
    await one.push([one.change({ from: 0, insert: "start " })]);
    await two.push([two.change({ from: 6, insert: " end" })]);
    expect(await contentOf(t)).toBe("start middle end");
  });

  it("rejects writes to a deleted note and a mismatched client queue", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    const { epoch } = await enableNote(owner, NOTE, "x");
    const client = new TestClient(owner, NOTE, epoch, CLIENT, "x");
    await client.push([client.change({ from: 1, insert: "a" })]);
    // Same client id, but its queue skips sequence numbers the server never saw.
    const skipped = new TestClient(owner, NOTE, epoch, CLIENT, "xa", 1);
    skipped.seq = 5;
    expect(await skipped.push([skipped.change({ from: 2, insert: "b" })])).toMatchObject({
      status: "error",
      code: "client_state_mismatch",
    });
    await owner.mutation(api.collab.deleteCloudNote, { noteId: NOTE });
    expect(await client.push([client.change({ from: 0, insert: "late" })], 1)).toMatchObject({
      status: "error",
      code: "deleted",
    });
  });

  it("reconstructs old versions across periodic checkpoints within the history read budget", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    const { epoch } = await enableNote(owner, NOTE, "");
    const client = new TestClient(owner, NOTE, epoch, CLIENT, "");
    const total = CHECKPOINT_INTERVAL * 2 + 25;
    for (let i = 0; i < total; i++) {
      const update = client.change({ from: client.text.length, insert: String(i % 10) });
      const result = await client.push([update]);
      expect(result.status).toBe("ok");
      client.text = update.apply();
      client.version++;
    }
    const expected = Array.from({ length: 30 }, (_, i) => String(i % 10)).join("");
    expect(await owner.query(api.collab.versionText, { noteId: NOTE, version: 30 })).toEqual({ text: expected, version: 30 });
    const late = await owner.query(api.collab.versionText, { noteId: NOTE, version: CHECKPOINT_INTERVAL + 7 });
    expect(late?.text).toHaveLength(CHECKPOINT_INTERVAL + 7);
  });
});

describe("agent access", () => {
  it("only reaches notes with an explicit grant, and read grants cannot edit", async () => {
    const { owner, agent, call } = await connectedNote("# Plan\n");
    expect((await call("notes")).json).toEqual({ notes: [], nextCursor: null });
    expect((await call(`notes/${NOTE}`)).status).toBe(404);

    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "read" });
    const read = await call(`notes/${NOTE}`);
    expect(read.status).toBe(200);
    const { note } = noteBody.parse(read.json);
    expect(note).toMatchObject({ content: "# Plan\n", access: "read" });
    const edit = await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: note.version, requestId: "req-read-0001", edits: [{ type: "append", text: "x" }] },
    });
    expect(edit.status).toBe(403);
    expect(await call("me")).toMatchObject({ status: 200, json: { agent: { name: "Claude Code" }, grantedNotes: 1 } });
  });

  it("rejects missing, malformed and revoked keys", async () => {
    const { t, owner, agent, call } = await connectedNote("text");
    expect((await agentFetch(t, "mna_" + "A".repeat(43))("me")).status).toBe(401);
    const bad = await t.fetch("/agent/v1/me", { headers: { Authorization: "Bearer nope" } });
    expect(bad.status).toBe(401);
    await owner.mutation(api.agents.revokeConnection, { connectionId: agent.connectionId });
    expect((await call("me")).status).toBe(401);
  });

  it("merges a stale non-overlapping edit while the person keeps typing", async () => {
    const { t, owner, enabled, agent, call } = await connectedNote("# Plan\n\n## Testing\nTBD\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);

    const human = new TestClient(owner, NOTE, enabled.epoch, CLIENT, note.content);
    await human.push([human.change({ from: 6, insert: " for launch" })]);

    const edit = await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: {
        version: note.version,
        requestId: "req-merge-0001",
        edits: [{ type: "replace", old: "## Testing\nTBD", new: "## Testing\n- unit tests" }],
      },
    });
    expect(edit.status).toBe(200);
    expect(await contentOf(t)).toBe("# Plan for launch\n\n## Testing\n- unit tests\n");

    const activity = await owner.query(api.collab.activity, { noteId: NOTE });
    expect(activity[0]).toMatchObject({ kind: "agent_edit", agentName: "Claude Code" });
    await owner.mutation(api.agents.renameConnection, { connectionId: agent.connectionId, name: "Codex" });
    expect((await owner.query(api.collab.activity, { noteId: NOTE }))[0].agentName).toBe("Codex");
  });

  it("rejects a stale edit that overlaps newer typing, and ambiguous passages", async () => {
    const { t, owner, enabled, agent, call } = await connectedNote("alpha\nbeta\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
    const human = new TestClient(owner, NOTE, enabled.epoch, CLIENT, note.content);
    await human.push([human.change({ from: 8, insert: "E" })]);

    const conflict = await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: note.version, requestId: "req-conflict-01", edits: [{ type: "replace", old: "beta", new: "BETA" }] },
    });
    expect(conflict.status).toBe(409);
    expect(errorCode(conflict.json)).toBe("conflict");
    expect(await contentOf(t)).toBe("alpha\nbeEta\n");

    const fresh = noteBody.parse((await call(`notes/${NOTE}`)).json).note;
    const ambiguous = await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: fresh.version, requestId: "req-ambig-0001", edits: [{ type: "replace", old: "a", new: "A" }] },
    });
    expect(ambiguous.status).toBe(422);
    expect(errorCode(ambiguous.json)).toBe("ambiguous_match");
  });

  it("replays a request id without applying it twice, and refuses reuse with a different edit", async () => {
    const { t, owner, agent, call } = await connectedNote("start\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
    const body = { version: note.version, requestId: "req-replay-001", edits: [{ type: "append", text: "added\n" }] };
    const first = await call(`notes/${NOTE}`, { method: "PATCH", body });
    const second = await call(`notes/${NOTE}`, { method: "PATCH", body });
    expect(first.status).toBe(200);
    expect(second).toMatchObject({ status: 200, json: { ...(first.json as object), replayed: true } });
    expect(await contentOf(t)).toBe("start\nadded\n");
    const reused = await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { ...body, edits: [{ type: "append", text: "other\n" }] },
    });
    expect(reused.status).toBe(409);
    expect(errorCode(reused.json)).toBe("request_id_reused");
  });

  it.each(["remove grant", "delete note", "downgrade to read"] as const)(
    "does not replay a cached edit result after: %s",
    async (change) => {
      const { owner, agent, call } = await connectedNote("secret plan\n");
      await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
      const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
      const body = { version: note.version, requestId: "req-cached-001", edits: [{ type: "append", text: "more\n" }] };
      expect((await call(`notes/${NOTE}`, { method: "PATCH", body })).status).toBe(200);

      if (change === "remove grant") {
        await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "none" });
      } else if (change === "delete note") {
        await owner.mutation(api.collab.deleteCloudNote, { noteId: NOTE });
      } else {
        await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "read" });
      }
      const replay = await call(`notes/${NOTE}`, { method: "PATCH", body });
      expect(replay.status).toBe(change === "downgrade to read" ? 403 : 404);
      expect(JSON.stringify(replay.json)).not.toContain("secret plan");
    },
  );

  it("refuses an oversized edit body at the HTTP action", async () => {
    const { t, owner, agent } = await connectedNote("x\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const response = await t.fetch(`/agent/v1/notes/${NOTE}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${agent.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: "x", requestId: "req-big-000001", edits: [{ type: "append", text: "a".repeat(300 * 1024) }] }),
    });
    expect(response.status).toBe(413);
    expect(await contentOf(t)).toBe("x\n");
  });

  it("validates request bodies and rate limits each key", async () => {
    const { owner, agent, call } = await connectedNote("x\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const invalid = await call(`notes/${NOTE}`, { method: "PATCH", body: { version: "x", edits: [] } });
    expect(invalid.status).toBe(400);
    expect(errorCode(invalid.json)).toBe("invalid_request");
    let limited = null;
    for (let i = 0; i < 130 && !limited; i++) {
      const response = await call("me");
      if (response.status === 429) limited = response;
    }
    expect(limited?.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});

describe("checkpoints and restore", () => {
  it("restores the pre-agent text as a new revision only when the preview is current", async () => {
    const { t, owner, enabled, agent, call } = await connectedNote("original\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
    await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: note.version, requestId: "req-restore-01", edits: [{ type: "replace", old: "original", new: "rewritten" }] },
    });
    const [checkpoint] = (await owner.query(api.collab.checkpoints, { noteId: NOTE })).filter(
      (item) => item.reason === "before_agent_edit",
    );
    expect(checkpoint.agentName).toBe("Claude Code");

    const human = new TestClient(owner, NOTE, enabled.epoch, CLIENT, "rewritten\n", 1);
    await human.push([human.change({ from: 10, insert: "typed later\n" })]);
    const stale = await owner.mutation(api.collab.restoreCheckpoint, {
      noteId: NOTE,
      epoch: enabled.epoch,
      checkpointId: checkpoint.id,
      expectedVersion: 1,
    });
    expect(stale).toEqual({ status: "stale", version: 2 });
    expect(await contentOf(t)).toBe("rewritten\ntyped later\n");

    const restored = await owner.mutation(api.collab.restoreCheckpoint, {
      noteId: NOTE,
      epoch: enabled.epoch,
      checkpointId: checkpoint.id,
      expectedVersion: 2,
    });
    expect(restored).toEqual({ status: "ok", version: 3 });
    expect(await contentOf(t)).toBe("original\n");
    const saved = (await owner.query(api.collab.checkpoints, { noteId: NOTE })).find((item) => item.reason === "before_restore");
    const savedText = await owner.query(api.collab.checkpointText, { noteId: NOTE, checkpointId: saved!.id });
    expect(savedText?.text).toBe("rewritten\ntyped later\n");
  });

  it("flags delayed human typing that lands inside an agent edit and keeps the pre-merge draft", async () => {
    const { owner, enabled, agent, call } = await connectedNote("one two three\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
    // The person typed inside "two" while offline, before the agent edit was accepted.
    const offline = new TestClient(owner, NOTE, enabled.epoch, CLIENT, "one two three\n");
    const pending = offline.change({ from: 5, insert: "X" });
    await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: note.version, requestId: "req-late-00001", edits: [{ type: "replace", old: "two", new: "2" }] },
    });
    expect((await offline.push([pending])).status).toBe("ok");
    const activity = await owner.query(api.collab.activity, { noteId: NOTE });
    expect(activity[0]).toMatchObject({ kind: "late_overlap" });
    const draft = await owner.query(api.collab.checkpointText, { noteId: NOTE, checkpointId: activity[0].checkpointId! });
    expect(draft?.text).toBe("one tXwo three\n");
  });
});

describe("size limits", () => {
  const big = "x".repeat(MAX_NOTE_CHARS + 1);

  it("refuses a chosen cloud copy over the limit before writing anything", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    await owner.mutation(api.notes.syncNote, { noteId: NOTE, content: big, updatedAt: 5 });
    const first = await owner.mutation(api.collab.enable, { noteId: NOTE, localText: "small" });
    expect(first.status).toBe("needs_choice");
    const chosen = await owner.mutation(api.collab.enable, {
      noteId: NOTE, localText: "small", choice: "cloud", expectedCloudUpdatedAt: 5,
    });
    expect(chosen).toEqual({ status: "too_large" });
    expect(await owner.query(api.collab.head, { noteId: NOTE })).toEqual({ status: "not_collab" });
    expect(await t.run((ctx) => ctx.db.query("noteCheckpoints").collect())).toHaveLength(0);
  });

  it("refuses to restore a saved version over the limit without writing", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    await owner.mutation(api.notes.syncNote, { noteId: NOTE, content: big, updatedAt: 5 });
    const enabled = await owner.mutation(api.collab.enable, {
      noteId: NOTE, localText: "small", choice: "local", expectedCloudUpdatedAt: 5,
    });
    if (enabled.status !== "enabled") throw new Error("setup");
    const unchosen = (await owner.query(api.collab.checkpoints, { noteId: NOTE })).find((item) => item.reason === "unchosen_copy");
    const before = await t.run((ctx) => ctx.db.query("noteCheckpoints").collect());
    const result = await owner.mutation(api.collab.restoreCheckpoint, {
      noteId: NOTE, epoch: enabled.epoch, checkpointId: unchosen!.id, expectedVersion: 0,
    });
    expect(result).toEqual({ status: "too_large" });
    expect(await t.run((ctx) => ctx.db.query("noteCheckpoints").collect())).toHaveLength(before.length);
    expect(await contentOf(t)).toBe("small");
  });

  it("refuses a stale disjoint agent edit when newer typing would push the note over the limit", async () => {
    const start = "head\n" + "a".repeat(100_000);
    const { t, owner, enabled, agent, call } = await connectedNote(start);
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
    const human = new TestClient(owner, NOTE, enabled.epoch, CLIENT, start);
    expect((await human.push([human.change({ from: start.length, insert: "b".repeat(99_990) })])).status).toBe("ok");
    const checkpointsBefore = (await t.run((ctx) => ctx.db.query("noteCheckpoints").collect())).length;
    const edit = await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: note.version, requestId: "req-limit-0001", edits: [{ type: "replace", old: "head", new: "head".repeat(20) }] },
    });
    expect(edit.status).toBe(413);
    expect(errorCode(edit.json)).toBe("note_too_large");
    expect((await t.run((ctx) => ctx.db.query("noteCheckpoints").collect())).length).toBe(checkpointsBefore);
    expect(await owner.query(api.collab.head, { noteId: NOTE })).toMatchObject({ version: 1 });
  });

  it("stores a whole 200,000-character CJK note and refuses batches that can't fit one document", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    const { epoch } = await enableNote(owner, NOTE, "");
    const client = new TestClient(owner, NOTE, epoch, CLIENT, "");
    const cjk = "漢".repeat(MAX_NOTE_CHARS);
    expect(await client.push([client.change({ from: 0, insert: cjk })])).toEqual({ status: "ok", version: 1 });
    expect((await contentOf(t))?.length).toBe(MAX_NOTE_CHARS);

    // Control characters take six bytes each once serialized.
    const second = await enableNote(owner, "Note000002", "");
    const other = new TestClient(owner, "Note000002", second.epoch, OTHER_CLIENT, "");
    const escaped = "\u0001".repeat(80_000);
    const a = other.change({ from: 0, insert: escaped });
    other.text = a.apply();
    const b = other.change({ from: 0, insert: escaped });
    expect(await other.push([a, b], 0)).toEqual({ status: "error", code: "batch_too_large" });
    const single = new TestClient(owner, "Note000002", second.epoch, "c_tab_three_003", "");
    expect(await single.push([single.change({ from: 0, insert: "\u0001".repeat(160_000) })], 0)).toEqual({
      status: "error",
      code: "too_large",
    });
  });
});

describe("note length", () => {
  it("refuses a batch that leaves the note too long, but accepts the same paste together with its undo", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    const { epoch } = await enableNote(owner, NOTE, "keep");
    const client = new TestClient(owner, NOTE, epoch, CLIENT, "keep");
    const paste = client.change({ from: 4, insert: "p".repeat(MAX_NOTE_CHARS) });
    expect(await client.push([paste])).toEqual({ status: "error", code: "note_too_long" });
    client.text = paste.apply();
    const undo = client.change({ from: 4, to: 4 + MAX_NOTE_CHARS });
    expect(await client.push([paste, undo], 0)).toEqual({ status: "ok", version: 2 });
    expect(await contentOf(t)).toBe("keep");
  });
});

describe("agent request receipts", () => {
  it("stores a compact receipt and replays it with the current note", async () => {
    const { t, owner, enabled, agent, call } = await connectedNote("alpha\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
    const body = { version: note.version, requestId: "req-receipt-01", edits: [{ type: "append", text: "agent line\n" }] };
    const first = await call(`notes/${NOTE}`, { method: "PATCH", body });
    expect(first.status).toBe(200);
    const receipts = await t.run((ctx) => ctx.db.query("agentRequests").collect());
    expect(receipts).toHaveLength(1);
    expect(receipts[0].body).not.toContain("alpha");
    expect(JSON.parse(receipts[0].body)).toEqual({ applied: 1, appliedVersion: expect.stringMatching(/\.1$/) });

    const human = new TestClient(owner, NOTE, enabled.epoch, CLIENT, "alpha\nagent line\n", 1);
    await human.push([human.change({ from: 0, insert: "typed " })]);
    const replay = await call(`notes/${NOTE}`, { method: "PATCH", body });
    expect(replay.json).toMatchObject({ replayed: true, applied: 1, appliedVersion: JSON.parse(receipts[0].body).appliedVersion });
    expect(noteBody.parse(replay.json).note.content).toBe("typed alpha\nagent line\n");
    expect(await contentOf(t)).toBe("typed alpha\nagent line\n");
  });

  it("prunes day-old receipts, and a late retry of a pruned edit is refused rather than applied twice", async () => {
    const { t, owner, agent, call } = await connectedNote("text\n");
    await owner.mutation(api.agents.setGrant, { noteId: NOTE, connectionId: agent.connectionId, access: "edit" });
    const { note } = noteBody.parse((await call(`notes/${NOTE}`)).json);
    const body = { version: note.version, requestId: "req-aged-00001", edits: [{ type: "append", text: "once\n" }] };
    expect((await call(`notes/${NOTE}`, { method: "PATCH", body })).status).toBe(200);
    await t.run(async (ctx) => {
      const receipt = await ctx.db.query("agentRequests").first();
      await ctx.db.patch(receipt!._id, { createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 });
    });
    const fresh = noteBody.parse((await call(`notes/${NOTE}`)).json).note;
    await call(`notes/${NOTE}`, {
      method: "PATCH",
      body: { version: fresh.version, requestId: "req-fresh-0001", edits: [{ type: "replace", old: "text", new: "TEXT" }] },
    });
    const remaining = await t.run((ctx) => ctx.db.query("agentRequests").collect());
    expect(remaining.map((receipt) => receipt.requestId)).toEqual(["req-fresh-0001"]);
    const late = await call(`notes/${NOTE}`, { method: "PATCH", body });
    expect(late.status).toBe(409);
    expect(await contentOf(t)).toBe("TEXT\nonce\n");
  });
});

describe("agent note listing", () => {
  it("pages through every granted note and searches each page", async () => {
    const t = setup();
    const { as: owner } = await signIn(t);
    const agent = await createAgent(owner);
    const call = agentFetch(t, agent.token);
    const ids = Array.from({ length: 23 }, (_, i) => `List${String(i).padStart(6, "0")}`);
    for (const [i, id] of ids.entries()) {
      await enableNote(owner, id, i % 5 === 0 ? `needle ${i}` : `note ${i}`);
      await owner.mutation(api.agents.setGrant, { noteId: id, connectionId: agent.connectionId, access: "read" });
    }
    const page = z.object({ notes: z.array(z.object({ id: z.string() })), nextCursor: z.string().nullable() });
    const seen: string[] = [];
    const matches: string[] = [];
    for (const [query, sink] of [["", seen], ["needle", matches]] as const) {
      let cursor: string | null = null;
      let pages = 0;
      do {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (cursor) params.set("cursor", cursor);
        const response = await call(`notes?${params}`);
        expect(response.status).toBe(200);
        const parsed = page.parse(response.json);
        expect(parsed.notes.length).toBeLessThanOrEqual(10);
        sink.push(...parsed.notes.map((item) => item.id));
        cursor = parsed.nextCursor;
        pages++;
      } while (cursor && pages < 10);
    }
    expect(seen.sort()).toEqual([...ids].sort());
    expect(matches.sort()).toEqual(ids.filter((_, i) => i % 5 === 0).sort());
    const connections = await owner.query(api.agents.listConnections, {});
    expect(connections[0].notes).toHaveLength(23);
    expect(connections[0].notes[0]).toEqual({ noteId: expect.any(String), access: "read" });
  });
});

