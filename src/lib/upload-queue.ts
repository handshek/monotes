import { liveQuery } from "dexie";
import { getDB, type NoteContent, type PendingUpload } from "@/lib/local-db";
import { becomeLocalOnly, pullCloudText, recordUpload, resolveConflict } from "@/lib/local-notes";
import type { NoteCloud, UploadResult } from "@/lib/note-cloud";

export interface UploadTiming {
  debounceMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}

const TIMING: UploadTiming = { debounceMs: 3_000, retryBaseMs: 5_000, retryMaxMs: 60_000 };

/* Runs a task while holding a note's lock. Resolves false if another tab holds it. */
export type NoteLock = (noteId: string, task: () => Promise<void>) => Promise<boolean>;

const browserLock: NoteLock = async (noteId, task) => {
  if (!navigator.locks) {
    await task();
    return true;
  }
  return navigator.locks.request(`monotes-upload:${noteId}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await task();
    return true;
  });
};

const isSyncedRow = (note: NoteContent | undefined): note is NoteContent =>
  !!note && !note.collab && note.cloudStatus !== "local";

const NOT_THEIRS = "This note belongs to someone else on this device";

/*
 * Uploads every Synced note with text the cloud lacks, whichever note is open
 * and however the person left it. The work is driven by the durable markers
 * in `pendingUploads`, so it survives reloads and reaches other tabs. Nothing
 * waits on it.
 */
export class UploadQueue {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private seen = new Map<string, number>();
  private failures = new Map<string, number>();
  private running = new Set<string>();
  private urgent = new Set<string>();
  // Requests from the open note that arrived before the session was confirmed.
  private awaitingAccount = new Map<string, () => void>();
  private account: string | null = null;
  private started = false;
  private loaded = false;
  private timing: UploadTiming;

  constructor(
    private cloud: NoteCloud,
    options: {
      timing?: Partial<UploadTiming>;
      lock?: NoteLock;
      isOnline?: () => boolean;
      /* A note this device thought was Synced turned out to be deleted from the cloud. */
      onDeletedElsewhere?: (noteId: string) => void;
    } = {},
  ) {
    this.timing = { ...TIMING, ...options.timing };
    this.lock = options.lock ?? browserLock;
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
    this.onDeletedElsewhere = options.onDeletedElsewhere ?? (() => {});
  }

  private lock: NoteLock;
  private isOnline: () => boolean;
  private onDeletedElsewhere: (noteId: string) => void;

  start() {
    this.started = true;
    const subscription = liveQuery(() => getDB().pendingUploads.toArray()).subscribe({
      next: this.onMarkers,
      // A failed read is retried by the next write or reconnect.
      error: () => {},
    });
    window.addEventListener("online", this.runAll);
    return () => {
      this.started = false;
      this.loaded = false;
      subscription.unsubscribe();
      window.removeEventListener("online", this.runAll);
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      this.seen.clear();
    };
  }

  /*
   * The account the session is confirmed to be, while it is also the current
   * owner, and otherwise null. Only that account's notes upload; everything
   * else waits, so a note never lands in another account.
   */
  setAccount(account: string | null) {
    if (this.account === account) return;
    this.account = account;
    if (!account) return;
    this.runAll();
    const waiting = [...this.awaitingAccount.values()];
    this.awaitingAccount.clear();
    for (const request of waiting) request();
  }

  /* Send a note's marked text without waiting for the debounce. */
  uploadNow(noteId: string) {
    // The marker's own notification follows this call and mustn't debounce it.
    this.urgent.add(noteId);
    this.schedule(noteId, 0);
  }

  /* The explicit first upload. If it fails the note stays Local only. */
  async syncToCloud(noteId: string) {
    const note = await getDB().notes.get(noteId);
    if (!note) throw new Error("This note isn’t on this device");
    if (note.owner !== this.account) throw new Error(NOT_THEIRS);
    await this.apply(note, await this.cloud.upload(note, { baseRevision: note.cloudRevision ?? null, explicit: true }));
  }

  /* The open note's cloud copy moved on. Bring it here, or let an upload settle it. */
  async pull(noteId: string) {
    if (!this.account) {
      this.awaitingAccount.set(noteId, () => void this.pull(noteId));
      return;
    }
    try {
      await this.lock(noteId, async () => {
        const db = getDB();
        const note = await db.notes.get(noteId);
        if (!isSyncedRow(note) || note.owner !== this.account) return;
        if (await db.pendingUploads.get(noteId)) {
          this.uploadNow(noteId);
          return;
        }
        const cloud = await this.cloud.fetch(noteId);
        if (!cloud) return;
        if (note.cloudRevision === undefined) await resolveConflict(noteId, cloud);
        else await pullCloudText(noteId, cloud);
      });
    } catch {
      // The note stays as it is; the next change to the cloud copy tries again.
    }
  }

  /* The open note's cloud copy was deleted on another device. */
  async deletedInCloud(noteId: string) {
    if (!this.account) {
      this.awaitingAccount.set(noteId, () => void this.deletedInCloud(noteId));
      return;
    }
    const note = await getDB().notes.get(noteId);
    if (!isSyncedRow(note) || note.owner !== this.account) return;
    if (await becomeLocalOnly(noteId)) this.onDeletedElsewhere(noteId);
  }

  private onMarkers = (markers: PendingUpload[]) => {
    const present = new Set(markers.map((marker) => marker.noteId));
    for (const noteId of this.seen.keys()) {
      if (!present.has(noteId)) {
        this.seen.delete(noteId);
        this.failures.delete(noteId);
      }
    }
    for (const { noteId, clock } of markers) {
      if (this.seen.get(noteId) === clock) continue;
      this.seen.set(noteId, clock);
      this.failures.delete(noteId);
      this.schedule(noteId, this.loaded && !this.urgent.has(noteId) ? this.timing.debounceMs : 0);
    }
    this.loaded = true;
  };

  private runAll = () => {
    for (const noteId of this.seen.keys()) this.schedule(noteId, 0);
  };

  private schedule(noteId: string, delayMs: number) {
    if (!this.started) return;
    clearTimeout(this.timers.get(noteId));
    this.timers.set(noteId, setTimeout(() => {
      this.timers.delete(noteId);
      void this.run(noteId);
    }, delayMs));
  }

  private async run(noteId: string) {
    this.urgent.delete(noteId);
    // Reconnecting or signing in calls runAll, so nothing is lost by stopping.
    if (!this.account || !this.isOnline() || this.running.has(noteId)) return;
    this.running.add(noteId);
    let delayMs: number | null = null;
    try {
      let waiting = false;
      const ran = await this.lock(noteId, async () => { waiting = await this.uploadMarked(noteId); });
      this.failures.delete(noteId);
      if (!ran || (!waiting && (await getDB().pendingUploads.get(noteId)))) delayMs = this.timing.debounceMs;
    } catch {
      const failures = (this.failures.get(noteId) ?? 0) + 1;
      this.failures.set(noteId, failures);
      delayMs = Math.min(this.timing.retryBaseMs * 2 ** (failures - 1), this.timing.retryMaxMs);
    } finally {
      this.running.delete(noteId);
    }
    if (delayMs !== null) this.schedule(noteId, delayMs);
  }

  /* Resolves true if the note must wait for its owner to come back. */
  private async uploadMarked(noteId: string) {
    const db = getDB();
    if (!(await db.pendingUploads.get(noteId))) return false;
    const note = await db.notes.get(noteId);
    if (!isSyncedRow(note)) {
      await db.pendingUploads.delete(noteId);
      return false;
    }
    if (note.owner !== this.account) return true;
    await this.apply(note, await this.cloud.upload(note, { baseRevision: note.cloudRevision ?? null }));
    return false;
  }

  private async apply(note: NoteContent, result: UploadResult) {
    switch (result.status) {
      case "ok":
        await recordUpload(note, result.revision);
        return;
      case "conflict":
        await resolveConflict(note.id, result.cloud);
        return;
      case "deleted":
        if (await becomeLocalOnly(note.id)) this.onDeletedElsewhere(note.id);
        return;
      case "connected":
        // Opening the note switches it over and keeps any differing text aside.
        await getDB().pendingUploads.delete(note.id);
        if (note.cloudStatus === "local") throw new Error("This note is shared with agents in your account");
        return;
      case "signed_out":
        throw new Error("Sign in to sync this note");
    }
  }
}
