import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { convexNoteCloud, type NoteCloud } from "../../src/lib/note-cloud";
import { setup, signIn } from "./backend-helpers";
import { MemoryCloud } from "./memory-cloud";

const NOTE = "Note000001";

interface Harness {
  cloud: NoteCloud;
  read(noteId: string): Promise<string | null>;
}

async function memoryHarness(): Promise<Harness> {
  const cloud = new MemoryCloud();
  return { cloud, read: async (noteId) => cloud.rows.get(noteId)?.content ?? null };
}

async function convexHarness(): Promise<Harness> {
  const { as } = await signIn(setup());
  const client = { mutation: as.mutation } as Parameters<typeof convexNoteCloud>[0];
  return {
    cloud: convexNoteCloud(client),
    read: async (noteId) => (await as.query(api.notes.getNote, { noteId }))?.content ?? null,
  };
}

/* The tests trust MemoryCloud only as far as it behaves like the real functions. */
describe.each([
  ["memory", memoryHarness],
  ["convex", convexHarness],
])("note cloud contract: %s", (_name, harness) => {
  it("creates a note on first upload", async () => {
    const { cloud, read } = await harness();
    await cloud.upload({ id: NOTE, content: "first", updatedAt: 1 });
    expect(await read(NOTE)).toBe("first");
  });

  it("replaces the text on a later upload", async () => {
    const { cloud, read } = await harness();
    await cloud.upload({ id: NOTE, content: "first", updatedAt: 1 });
    await cloud.upload({ id: NOTE, content: "second", updatedAt: 2 });
    expect(await read(NOTE)).toBe("second");
  });
});
