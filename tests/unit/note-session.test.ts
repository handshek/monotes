// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDB, type NoteContent } from "../../src/lib/local-db";
import { createDraft, readPendingDraft, writePendingDraft } from "../../src/lib/local-drafts";
import { saveNote } from "../../src/lib/local-notes";
import { deviceNoteStore, NoteSession } from "../../src/lib/note-session";

const NOTE = "Note000001";
const row = (content: string, cloudStatus: NoteContent["cloudStatus"] = "local"): NoteContent => ({
  id: NOTE,
  content,
  updatedAt: 1,
  cloudStatus,
});

async function opened(store = deviceNoteStore) {
  const session = new NoteSession(NOTE, store);
  const close = session.open();
  await vi.waitFor(() => expect(session.getSnapshot().isLoading).toBe(false));
  return { session, close };
}

beforeEach(async () => {
  sessionStorage.clear();
  await getDB().delete();
  await getDB().open();
});

describe("NoteSession", () => {
  it("shows typing at once and clears the draft once stored", async () => {
    await getDB().notes.put(row("old"));
    const { session, close } = await opened();
    session.setMarkdown("new");
    expect(session.getSnapshot().note?.content).toBe("new");
    expect(session.getSnapshot().isSaving).toBe(true);
    expect(readPendingDraft(NOTE)?.content).toBe("new");
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false));
    expect((await getDB().notes.get(NOTE))?.content).toBe("new");
    expect(readPendingDraft(NOTE)).toBeNull();
    close();
  });

  it("reports a missing note as null", async () => {
    const { session, close } = await opened();
    expect(session.getSnapshot().note).toBeNull();
    close();
  });

  it("finishes the save after the note is closed", async () => {
    await getDB().notes.put(row("old"));
    const { session, close } = await opened();
    session.setMarkdown("left behind");
    close();
    await vi.waitFor(async () => expect((await getDB().notes.get(NOTE))?.content).toBe("left behind"));
  });

  it("recovers a draft a reload left in this tab", async () => {
    await getDB().notes.put(row("old"));
    writePendingDraft(createDraft(row("old"), "recovered"));
    const { session, close } = await opened();
    expect(session.getSnapshot().note?.content).toBe("recovered");
    await vi.waitFor(async () => expect((await getDB().notes.get(NOTE))?.content).toBe("recovered"));
    close();
  });

  it("drops a recovered draft older than the row, and reports the replaced text", async () => {
    writePendingDraft({ ...createDraft(row("old"), "stale"), updatedAt: 2, localRevision: { clock: 2, actor: "a" } });
    await getDB().notes.put({ ...row("newer"), updatedAt: 9, localRevision: { clock: 9, actor: "b" } });
    const { session, close } = await opened();
    expect(session.getSnapshot().note?.content).toBe("newer");
    expect(session.getSnapshot().replacedRevision).toEqual({ clock: 2, actor: "a" });
    expect(readPendingDraft(NOTE)).toBeNull();
    close();
  });

  it("drops a recovered draft for a deleted note", async () => {
    writePendingDraft(createDraft(row("old"), "gone"));
    const { session, close } = await opened();
    expect(session.getSnapshot().note).toBeNull();
    expect(readPendingDraft(NOTE)).toBeNull();
    close();
  });

  it("gives way when another tab's newer write lands first", async () => {
    await getDB().notes.put(row("old"));
    const mine = createDraft(row("old"), "mine");
    let release = () => {};
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const store = { ...deviceNoteStore, save: async () => { await blocked; return saveNote(mine); } };
    const slow = await opened(store);
    slow.session.setMarkdown("mine");
    await saveNote({ ...createDraft(row("old"), "theirs"), updatedAt: Date.now() + 5_000, localRevision: { clock: Date.now() + 5_000, actor: "z" } });
    await vi.waitFor(() => expect(slow.session.getSnapshot().note?.content).toBe("theirs"));
    release();
    expect(slow.session.getSnapshot().replacedRevision).not.toBeNull();
    slow.close();
  });

  it("surfaces a storage failure and keeps the typing visible", async () => {
    await getDB().notes.put(row("old"));
    const { session, close } = await opened({ ...deviceNoteStore, save: () => Promise.reject(new Error("quota")) });
    session.setMarkdown("unsaved");
    await vi.waitFor(() => expect(session.getSnapshot().saveError).toMatch(/aren’t saved/));
    expect(session.getSnapshot().note?.content).toBe("unsaved");
    expect(readPendingDraft(NOTE)?.content).toBe("unsaved");
    await expect(session.saveNow()).rejects.toThrow("quota");
    close();
  });

  it("saveNow says when the note was deleted", async () => {
    await getDB().notes.put(row("old"));
    const { session, close } = await opened();
    session.setMarkdown("typed");
    await getDB().notes.clear();
    await vi.waitFor(() => expect(session.getSnapshot().note).toBeNull());
    await expect(session.saveNow()).rejects.toThrow("unavailable");
    close();
  });
});
