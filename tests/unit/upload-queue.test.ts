// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDB, type NoteContent } from "../../src/lib/local-db";
import { createDraft } from "../../src/lib/local-drafts";
import { saveNote } from "../../src/lib/local-notes";
import { UploadQueue, type NoteLock } from "../../src/lib/upload-queue";
import { MemoryCloud } from "./memory-cloud";

const NOTE = "Note000001";
const ACCOUNT = "user_a";
const timing = { debounceMs: 10, retryBaseMs: 10, retryMaxMs: 40 };
const row = (content: string, cloudStatus: NoteContent["cloudStatus"] = "synced"): NoteContent => ({
  id: NOTE,
  owner: ACCOUNT,
  content,
  updatedAt: 1,
  cloudStatus,
});
const type = async (note: NoteContent, text: string) => saveNote(createDraft(note, text));
const pending = () => getDB().pendingUploads.get(NOTE);
const settled = () => vi.waitFor(async () => expect(await pending()).toBeUndefined());
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let stops: (() => void)[] = [];
function startQueue(cloud: MemoryCloud, options: ConstructorParameters<typeof UploadQueue>[1] = {}) {
  const queue = new UploadQueue(cloud, { timing, isOnline: () => true, ...options });
  stops.push(queue.start());
  queue.setAccount(ACCOUNT);
  return queue;
}

beforeEach(async () => {
  await getDB().delete();
  await getDB().open();
});
afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
});

describe("durable marker", () => {
  it("is written with the row for a Synced note", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    expect(await pending()).toBeDefined();
  });

  it("is not written for a Local only note", async () => {
    await getDB().notes.put(row("old", "local"));
    await type(row("old", "local"), "new");
    expect(await pending()).toBeUndefined();
  });

  it("is not written for a connected note", async () => {
    const connected = { ...row("old"), collab: { epoch: "e" } };
    await getDB().notes.put(connected);
    await type(connected, "new");
    expect(await pending()).toBeUndefined();
  });
});

describe("UploadQueue", () => {
  it("uploads text left behind by leaving the note before the debounce", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "typed then left");
    // No editor is open: the old timer lived in the editor and died with it.
    const cloud = new MemoryCloud();
    startQueue(cloud);
    await settled();
    expect(cloud.uploads).toEqual(["typed then left"]);
  });

  it("debounces a burst of typing into one upload", async () => {
    await getDB().notes.put(row(""));
    const cloud = new MemoryCloud();
    startQueue(cloud, { timing: { ...timing, debounceMs: 60 } });
    await wait(5);
    let note: NoteContent | null = row("");
    for (const text of ["a", "ab", "abc"]) {
      note = await type(note!, text);
      await wait(5);
    }
    await settled();
    expect(cloud.uploads).toEqual(["abc"]);
  });

  it("leaves rows without a marker alone", async () => {
    await getDB().notes.put(row("never edited after this release"));
    const cloud = new MemoryCloud();
    startQueue(cloud);
    await wait(40);
    expect(cloud.uploads).toEqual([]);
  });

  it("retries a failed upload and then clears the marker", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    const cloud = new MemoryCloud();
    cloud.failNext = 2;
    startQueue(cloud);
    await settled();
    expect(cloud.uploads).toEqual(["new"]);
  });

  it("waits for a connection and sends on the online event", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "offline");
    const cloud = new MemoryCloud();
    let online = false;
    startQueue(cloud, { isOnline: () => online });
    await wait(30);
    expect(cloud.uploads).toEqual([]);
    online = true;
    window.dispatchEvent(new Event("online"));
    await settled();
    expect(cloud.uploads).toEqual(["offline"]);
  });

  it("pauses while signed out and resumes after sign-in", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "held");
    const cloud = new MemoryCloud();
    const queue = new UploadQueue(cloud, { timing, isOnline: () => true });
    stops.push(queue.start());
    await wait(30);
    expect(cloud.uploads).toEqual([]);
    queue.setAccount(ACCOUNT);
    await settled();
    expect(cloud.uploads).toEqual(["held"]);
  });

  it("never uploads another owner's note, and sends it when they return", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "theirs");
    const cloud = new MemoryCloud();
    const queue = startQueue(cloud);
    queue.setAccount("user_b");
    await wait(40);
    expect(cloud.uploads).toEqual([]);
    expect(await pending()).toBeDefined();
    queue.setAccount(ACCOUNT);
    await settled();
    expect(cloud.uploads).toEqual(["theirs"]);
  });

  it("keeps the marker when typing lands during an upload, then sends the new text", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "first");
    const cloud = new MemoryCloud();
    let release = () => {};
    cloud.gate = new Promise<void>((resolve) => { release = resolve; });
    startQueue(cloud);
    await wait(20);
    await type((await getDB().notes.get(NOTE))!, "second");
    cloud.gate = null;
    release();
    await settled();
    expect(cloud.uploads).toEqual(["first", "second"]);
    expect(cloud.rows.get(NOTE)?.content).toBe("second");
  });

  it("drops the marker of a deleted note", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    await getDB().notes.delete(NOTE);
    const cloud = new MemoryCloud();
    startQueue(cloud);
    await settled();
    expect(cloud.uploads).toEqual([]);
  });

  it("drops the marker of a note connected for agents", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    await getDB().notes.update(NOTE, { collab: { epoch: "e" } });
    const cloud = new MemoryCloud();
    startQueue(cloud);
    await settled();
    expect(cloud.uploads).toEqual([]);
  });

  it("sends once when two tabs race for the same note", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    const held = new Set<string>();
    const lock: NoteLock = async (noteId, task) => {
      if (held.has(noteId)) return false;
      held.add(noteId);
      try { await task(); } finally { held.delete(noteId); }
      return true;
    };
    const cloud = new MemoryCloud();
    startQueue(cloud, { lock });
    startQueue(cloud, { lock });
    await settled();
    await wait(30);
    expect(cloud.uploads).toEqual(["new"]);
  });

  it("uploadNow skips the debounce", async () => {
    await getDB().notes.put(row("old"));
    const cloud = new MemoryCloud();
    const queue = startQueue(cloud, { timing: { ...timing, debounceMs: 10_000 } });
    await wait(5);
    await type(row("old"), "now");
    queue.uploadNow(NOTE);
    await settled();
    expect(cloud.uploads).toEqual(["now"]);
  });
});

describe("first upload", () => {
  it("marks the note Synced", async () => {
    await getDB().notes.put(row("text", "local"));
    const cloud = new MemoryCloud();
    await startQueue(cloud).syncToCloud(NOTE);
    expect((await getDB().notes.get(NOTE))?.cloudStatus).toBe("synced");
    expect(cloud.rows.get(NOTE)?.content).toBe("text");
  });

  it("refuses a note that isn't the signed-in account's", async () => {
    await getDB().notes.put({ ...row("text", "local"), owner: "user_b" });
    const cloud = new MemoryCloud();
    await expect(startQueue(cloud).syncToCloud(NOTE)).rejects.toThrow("someone else");
    expect(cloud.uploads).toEqual([]);
  });

  it("leaves the note Local only when it fails", async () => {
    await getDB().notes.put(row("text", "local"));
    const cloud = new MemoryCloud();
    cloud.failNext = 1;
    await expect(startQueue(cloud).syncToCloud(NOTE)).rejects.toThrow("network");
    expect((await getDB().notes.get(NOTE))?.cloudStatus).toBe("local");
  });

  it("marks text typed during the upload", async () => {
    await getDB().notes.put(row("first", "local"));
    const cloud = new MemoryCloud();
    let release = () => {};
    cloud.gate = new Promise<void>((resolve) => { release = resolve; });
    const uploading = startQueue(cloud).syncToCloud(NOTE);
    await wait(5);
    await type(row("first", "local"), "second");
    cloud.gate = null;
    release();
    await uploading;
    await settled();
    expect(cloud.rows.get(NOTE)?.content).toBe("second");
  });
});
