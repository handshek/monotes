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

  it("brings back a note deleted elsewhere, because the person chose to", async () => {
    await getDB().notes.put(row("back again", "local"));
    const cloud = new MemoryCloud();
    cloud.rows.set(NOTE, { content: "old", updatedAt: 1, revision: 4, deleted: true });
    await startQueue(cloud).syncToCloud(NOTE);
    expect(cloud.rows.get(NOTE)).toMatchObject({ content: "back again", revision: 5 });
    expect(cloud.rows.get(NOTE)?.deleted).toBeUndefined();
  });

  it("reports a note connected in the cloud and leaves it Local only", async () => {
    await getDB().notes.put(row("text", "local"));
    const cloud = new MemoryCloud();
    cloud.rows.set(NOTE, { content: "shared", updatedAt: 1, revision: 1, connected: true });
    await expect(startQueue(cloud).syncToCloud(NOTE)).rejects.toThrow("shared with agents");
    expect((await getDB().notes.get(NOTE))?.cloudStatus).toBe("local");
  });
});

describe("version check", () => {
  const stored = async () => (await getDB().notes.get(NOTE))!;
  const kept = async () => (await getDB().recoveries.toArray()).map(({ text, reason }) => ({ text, reason }));
  const inCloud = (cloud: MemoryCloud, content: string, revision: number, updatedAt = 5) =>
    cloud.rows.set(NOTE, { content, updatedAt, revision });

  it("uploads edits when the cloud is unchanged, and records the revision", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    await type({ ...row("old"), cloudRevision: 3 }, "edited");
    const cloud = new MemoryCloud();
    inCloud(cloud, "old", 3);
    startQueue(cloud);
    await settled();
    expect(cloud.rows.get(NOTE)).toMatchObject({ content: "edited", revision: 4 });
    expect((await stored()).cloudRevision).toBe(4);
    expect(await kept()).toEqual([]);
  });

  it("pulls newer cloud text when there are no edits", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    const cloud = new MemoryCloud();
    inCloud(cloud, "from elsewhere", 4, 77);
    await startQueue(cloud).pull(NOTE);
    expect(await stored()).toMatchObject({ content: "from elsewhere", cloudRevision: 4, updatedAt: 77 });
    expect(await pending()).toBeUndefined();
    expect(await kept()).toEqual([]);
  });

  it("keeps the typing and sets the cloud text aside when both changed", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    await type({ ...row("old"), cloudRevision: 3 }, "my edit");
    const cloud = new MemoryCloud();
    inCloud(cloud, "their edit", 4);
    startQueue(cloud);
    await settled();
    expect((await stored()).content).toBe("my edit");
    expect(await kept()).toEqual([{ text: "their edit", reason: "cloud_version" }]);
    expect(cloud.rows.get(NOTE)).toMatchObject({ content: "my edit", revision: 5 });
  });

  it("keeps a conflict's cloud text only once when the upload retries", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    await type({ ...row("old"), cloudRevision: 3 }, "my edit");
    const cloud = new MemoryCloud();
    inCloud(cloud, "their edit", 4);
    const queue = startQueue(cloud);
    await settled();
    await getDB().pendingUploads.put({ noteId: NOTE, clock: 1 });
    await getDB().notes.update(NOTE, { cloudRevision: 3 });
    inCloud(cloud, "their edit", 9);
    queue.uploadNow(NOTE);
    await settled();
    expect(await kept()).toHaveLength(1);
  });

  it("uploads on a draft that lands after a pull, and keeps the text it hid", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    const draft = createDraft({ ...row("old"), cloudRevision: 3 }, "typed over old");
    const cloud = new MemoryCloud();
    inCloud(cloud, "pulled", 4);
    await startQueue(cloud).pull(NOTE);
    await saveNote(draft);
    await settled();
    expect((await stored()).content).toBe("typed over old");
    expect(await kept()).toEqual([{ text: "pulled", reason: "cloud_version" }]);
    expect(cloud.rows.get(NOTE)?.content).toBe("typed over old");
  });

  it("keeps earlier own text out of Kept text when typing continues through an upload", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    const first = await type({ ...row("old"), cloudRevision: 3 }, "one");
    const cloud = new MemoryCloud();
    inCloud(cloud, "old", 3);
    startQueue(cloud);
    await settled();
    await type(first!, "one two");
    await settled();
    expect(await kept()).toEqual([]);
  });

  describe("first contact", () => {
    it("adopts the revision silently when the text matches", async () => {
      await getDB().notes.put(row("same"));
      const cloud = new MemoryCloud();
      inCloud(cloud, "same", 6);
      await startQueue(cloud).pull(NOTE);
      expect((await stored()).cloudRevision).toBe(6);
      expect(await kept()).toEqual([]);
    });

    it("takes newer cloud text and keeps this device's", async () => {
      await getDB().notes.put({ ...row("device"), updatedAt: 1 });
      const cloud = new MemoryCloud();
      inCloud(cloud, "cloud", 6, 9);
      await startQueue(cloud).pull(NOTE);
      expect(await stored()).toMatchObject({ content: "cloud", cloudRevision: 6 });
      expect(await kept()).toEqual([{ text: "device", reason: "before_cloud_version" }]);
      expect(cloud.uploads).toEqual([]);
    });

    it("keeps newer device text, sets the cloud text aside and uploads", async () => {
      await getDB().notes.put({ ...row("device"), updatedAt: 9 });
      const cloud = new MemoryCloud();
      inCloud(cloud, "cloud", 6, 1);
      await startQueue(cloud).pull(NOTE);
      await settled();
      expect((await stored()).content).toBe("device");
      expect(await kept()).toEqual([{ text: "cloud", reason: "cloud_version" }]);
      expect(cloud.rows.get(NOTE)).toMatchObject({ content: "device", revision: 7 });
    });

    it("uploads when there is no cloud row", async () => {
      await getDB().notes.put(row("old"));
      await type(row("old"), "new");
      const cloud = new MemoryCloud();
      startQueue(cloud);
      await settled();
      expect((await stored()).cloudRevision).toBe(1);
    });
  });

  it("makes a note deleted elsewhere Local only, without bringing it back", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    await type({ ...row("old"), cloudRevision: 3 }, "edited");
    const cloud = new MemoryCloud();
    cloud.rows.set(NOTE, { content: "old", updatedAt: 1, revision: 3, deleted: true });
    const notices: string[] = [];
    startQueue(cloud, { onDeletedElsewhere: (id) => notices.push(id) });
    await settled();
    expect(await stored()).toMatchObject({ content: "edited", cloudStatus: "local" });
    expect((await stored()).cloudRevision).toBeUndefined();
    expect(cloud.rows.get(NOTE)?.deleted).toBe(true);
    expect(notices).toEqual([NOTE]);
  });

  it("makes an open note deleted elsewhere Local only", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    const notices: string[] = [];
    await startQueue(new MemoryCloud(), { onDeletedElsewhere: (id) => notices.push(id) }).deletedInCloud(NOTE);
    expect((await stored()).cloudStatus).toBe("local");
    expect(notices).toEqual([NOTE]);
  });

  it("drops the marker when the note turns out to be connected", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    await type({ ...row("old"), cloudRevision: 3 }, "edited");
    const cloud = new MemoryCloud();
    cloud.rows.set(NOTE, { content: "shared", updatedAt: 1, revision: 3, connected: true });
    startQueue(cloud);
    await settled();
    expect((await stored()).content).toBe("edited");
    expect(cloud.uploads).toEqual([]);
  });

  it("waits for the session when the open note asks to pull during page load", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    const cloud = new MemoryCloud();
    inCloud(cloud, "newer", 4);
    const queue = new UploadQueue(cloud, { timing, isOnline: () => true });
    stops.push(queue.start());
    await queue.pull(NOTE);
    expect((await stored()).content).toBe("old");
    queue.setAccount(ACCOUNT);
    await vi.waitFor(async () => expect((await stored()).content).toBe("newer"));
  });

  it("leaves the note as it is when fetching cloud text fails", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    const cloud = new MemoryCloud();
    cloud.fetch = () => Promise.reject(new Error("network"));
    await startQueue(cloud).pull(NOTE);
    expect((await stored()).content).toBe("old");
  });

  it("does not pull a note with unuploaded edits, and lets the upload settle it", async () => {
    await getDB().notes.put({ ...row("old"), cloudRevision: 3 });
    await type({ ...row("old"), cloudRevision: 3 }, "mine");
    const cloud = new MemoryCloud();
    inCloud(cloud, "theirs", 4);
    await startQueue(cloud).pull(NOTE);
    await settled();
    expect((await stored()).content).toBe("mine");
    expect(await kept()).toEqual([{ text: "theirs", reason: "cloud_version" }]);
  });
});

describe("upload status", () => {
  it("says Synced only once the cloud holds the text", async () => {
    await getDB().notes.put(row("old"));
    const cloud = new MemoryCloud();
    let release = () => {};
    cloud.gate = new Promise<void>((resolve) => { release = resolve; });
    const queue = startQueue(cloud);
    await wait(5);
    expect(queue.statusOf(NOTE)).toBe("synced");
    await type(row("old"), "new");
    await vi.waitFor(() => expect(queue.statusOf(NOTE)).toBe("syncing"));
    release();
    cloud.gate = null;
    await vi.waitFor(() => expect(queue.statusOf(NOTE)).toBe("synced"));
    expect(cloud.uploads).toEqual(["new"]);
  });

  it("says Waiting to upload after a failure, and clears it on success", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    const cloud = new MemoryCloud();
    cloud.failNext = 1;
    const queue = startQueue(cloud, { timing: { ...timing, retryBaseMs: 300, retryMaxMs: 300 } });
    await vi.waitFor(() => expect(queue.statusOf(NOTE)).toBe("waiting"), { interval: 5 });
    await vi.waitFor(() => expect(queue.statusOf(NOTE)).toBe("synced"));
  });

  it("says Waiting to upload offline", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    const queue = startQueue(new MemoryCloud(), { isOnline: () => false });
    await vi.waitFor(() => expect(queue.statusOf(NOTE)).toBe("waiting"));
  });

  it("says Sign in to sync with no confirmed account", async () => {
    await getDB().notes.put(row("old"));
    await type(row("old"), "new");
    const queue = new UploadQueue(new MemoryCloud(), { timing, isOnline: () => true });
    stops.push(queue.start());
    await vi.waitFor(() => expect(queue.statusOf(NOTE)).toBe("sign_in"));
  });

  it("tells subscribers when the status changes", async () => {
    await getDB().notes.put(row("old"));
    const queue = startQueue(new MemoryCloud());
    const seen: string[] = [];
    queue.subscribe(() => seen.push(queue.statusOf(NOTE)));
    await wait(5);
    await type(row("old"), "new");
    await settled();
    await vi.waitFor(() => expect(seen).toContain("syncing"));
    await vi.waitFor(() => expect(seen.at(-1)).toBe("synced"));
  });
});
