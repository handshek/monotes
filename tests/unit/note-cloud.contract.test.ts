import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { convexNoteCloud, type NoteCloud } from "../../src/lib/note-cloud";
import { enableNote, setup, signIn } from "./backend-helpers";
import { MemoryCloud } from "./memory-cloud";

const NOTE = "Note000001";
const note = (content: string, updatedAt = 1) => ({ id: NOTE, content, updatedAt });
const background = { baseRevision: null };

interface Harness {
  cloud: NoteCloud;
  signedOutCloud: () => NoteCloud;
  read(noteId: string): Promise<string | null>;
  remove(noteId: string): Promise<void>;
  connect(noteId: string, text: string): Promise<void>;
}

async function memoryHarness(): Promise<Harness> {
  const cloud = new MemoryCloud();
  return {
    cloud,
    signedOutCloud() {
      const out = new MemoryCloud();
      out.signedOut = true;
      return out;
    },
    read: async (noteId) => (cloud.rows.get(noteId)?.deleted ? null : (cloud.rows.get(noteId)?.content ?? null)),
    remove: async (noteId) => { cloud.rows.get(noteId)!.deleted = true; },
    connect: async (noteId, text) => {
      cloud.rows.set(noteId, { content: text, updatedAt: 1, revision: 0, connected: true });
    },
  };
}

async function convexHarness(): Promise<Harness> {
  const t = setup();
  const { as } = await signIn(t);
  const client = (who: typeof t | typeof as) =>
    ({ mutation: who.mutation, query: who.query }) as unknown as Parameters<typeof convexNoteCloud>[0];
  return {
    cloud: convexNoteCloud(client(as)),
    signedOutCloud: () => convexNoteCloud(client(t)),
    read: async (noteId) => (await as.query(api.notes.getNote, { noteId }))?.content ?? null,
    remove: async (noteId) => { await as.mutation(api.notes.deleteNote, { noteId }); },
    connect: async (noteId, text) => { await enableNote(as, noteId, text); },
  };
}

/* The tests trust MemoryCloud only as far as it behaves like the real functions. */
describe.each([
  ["memory", memoryHarness],
  ["convex", convexHarness],
])("note cloud contract: %s", (_name, harness) => {
  it("creates a note on first upload", async () => {
    const { cloud, read } = await harness();
    expect(await cloud.upload(note("first"), background)).toEqual({ status: "ok", revision: 1 });
    expect(await read(NOTE)).toBe("first");
  });

  it("accepts text edited from the latest revision", async () => {
    const { cloud, read } = await harness();
    await cloud.upload(note("first"), background);
    expect(await cloud.upload(note("second", 2), { baseRevision: 1 })).toEqual({ status: "ok", revision: 2 });
    expect(await read(NOTE)).toBe("second");
  });

  it("refuses text edited from an older revision and returns the cloud text", async () => {
    const { cloud, read } = await harness();
    await cloud.upload(note("first", 7), background);
    await cloud.upload(note("second", 8), { baseRevision: 1 });
    expect(await cloud.upload(note("stale"), { baseRevision: 1 })).toEqual({
      status: "conflict",
      cloud: { content: "second", updatedAt: 8, revision: 2 },
    });
    expect(await read(NOTE)).toBe("second");
  });

  it("refuses differing text before first contact", async () => {
    const { cloud } = await harness();
    await cloud.upload(note("first", 7), background);
    expect((await cloud.upload(note("other"), background)).status).toBe("conflict");
  });

  it("accepts matching text without a new revision", async () => {
    const { cloud } = await harness();
    await cloud.upload(note("same"), background);
    expect(await cloud.upload(note("same"), background)).toEqual({ status: "ok", revision: 1 });
  });

  it("never brings a deleted note back from a background upload", async () => {
    const { cloud, read, remove } = await harness();
    await cloud.upload(note("first"), background);
    await remove(NOTE);
    expect(await cloud.upload(note("edited"), { baseRevision: 1 })).toEqual({ status: "deleted" });
    expect(await read(NOTE)).toBeNull();
  });

  it("brings a deleted note back on an explicit sync", async () => {
    const { cloud, read, remove } = await harness();
    await cloud.upload(note("first"), background);
    await remove(NOTE);
    expect(await cloud.upload(note("back"), { baseRevision: null, explicit: true })).toEqual({ status: "ok", revision: 2 });
    expect(await read(NOTE)).toBe("back");
  });

  it("refuses a connected note", async () => {
    const { cloud, connect } = await harness();
    await connect(NOTE, "shared");
    expect(await cloud.upload(note("whole note"), background)).toEqual({ status: "connected" });
  });

  it("reports a signed-out session", async () => {
    const { signedOutCloud } = await harness();
    expect(await signedOutCloud().upload(note("text"), background)).toEqual({ status: "signed_out" });
  });

  it("fetches the cloud text and revision", async () => {
    const { cloud } = await harness();
    await cloud.upload(note("first", 7), background);
    expect(await cloud.fetch(NOTE)).toEqual({ content: "first", updatedAt: 7, revision: 1 });
  });

  it("fetches nothing for a missing, deleted or connected note", async () => {
    const { cloud, remove, connect } = await harness();
    expect(await cloud.fetch(NOTE)).toBeNull();
    await cloud.upload(note("first"), background);
    await remove(NOTE);
    expect(await cloud.fetch(NOTE)).toBeNull();
    await connect("Note000002", "shared");
    expect(await cloud.fetch("Note000002")).toBeNull();
  });

  it("lists only the ids of notes it holds", async () => {
    const { cloud, remove } = await harness();
    await cloud.upload(note("first"), background);
    await cloud.upload({ id: "Note000002", content: "second", updatedAt: 1 }, background);
    await remove(NOTE);
    expect(await cloud.listNoteIds()).toEqual(["Note000002"]);
  });
});

describe("older writers", () => {
  it("bumps the revision from syncNote and updateNote, so devices notice", async () => {
    const { as } = await signIn(setup());
    const write = { noteId: NOTE, content: "old tab", updatedAt: 1 };
    await as.mutation(api.notes.syncNote, write);
    await as.mutation(api.notes.syncNote, { ...write, content: "old tab 2" });
    await as.mutation(api.notes.updateNote, { ...write, content: "old tab 3" });
    expect(await as.query(api.collab.openInfo, { noteId: NOTE })).toMatchObject({ status: "ok", revision: 3 });
  });

  it("treats a row from before revisions as revision 0", async () => {
    const t = setup();
    const { as, userId } = await signIn(t);
    await t.run((ctx) => ctx.db.insert("notes", { userId, noteId: NOTE, content: "legacy", updatedAt: 1 }));
    expect(await as.query(api.collab.openInfo, { noteId: NOTE })).toMatchObject({ revision: 0 });
    const cloud = convexNoteCloud({ mutation: as.mutation, query: as.query } as unknown as Parameters<typeof convexNoteCloud>[0]);
    expect(await cloud.upload(note("edited", 2), { baseRevision: 0 })).toEqual({ status: "ok", revision: 1 });
  });

  it("keeps openInfo free of note text", async () => {
    const { as } = await signIn(setup());
    await as.mutation(api.notes.syncNote, { noteId: NOTE, content: "private", updatedAt: 1 });
    expect(JSON.stringify(await as.query(api.collab.openInfo, { noteId: NOTE }))).not.toContain("private");
  });
});
