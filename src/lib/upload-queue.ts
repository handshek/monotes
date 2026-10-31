import { liveQuery } from "dexie";
import { getDB, type NoteContent, type PendingUpload } from "@/lib/local-db";
import { clearPendingUpload, markSynced } from "@/lib/local-notes";
import type { NoteCloud } from "@/lib/note-cloud";

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
  private signedIn = false;
  private started = false;
  private loaded = false;
  private timing: UploadTiming;

  constructor(
    private cloud: NoteCloud,
    options: { timing?: Partial<UploadTiming>; lock?: NoteLock; isOnline?: () => boolean } = {},
  ) {
    this.timing = { ...TIMING, ...options.timing };
    this.lock = options.lock ?? browserLock;
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
  }

  private lock: NoteLock;
  private isOnline: () => boolean;

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

  /* Uploads pause while signed out and resume from the markers afterwards. */
  setSignedIn(signedIn: boolean) {
    if (this.signedIn === signedIn) return;
    this.signedIn = signedIn;
    if (signedIn) this.runAll();
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
    await this.cloud.upload(note);
    await markSynced(note);
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
    if (!this.signedIn || !this.isOnline() || this.running.has(noteId)) return;
    this.running.add(noteId);
    let delayMs: number | null = null;
    try {
      const ran = await this.lock(noteId, () => this.uploadMarked(noteId));
      this.failures.delete(noteId);
      if (!ran || (await getDB().pendingUploads.get(noteId))) delayMs = this.timing.debounceMs;
    } catch {
      const failures = (this.failures.get(noteId) ?? 0) + 1;
      this.failures.set(noteId, failures);
      delayMs = Math.min(this.timing.retryBaseMs * 2 ** (failures - 1), this.timing.retryMaxMs);
    } finally {
      this.running.delete(noteId);
    }
    if (delayMs !== null) this.schedule(noteId, delayMs);
  }

  private async uploadMarked(noteId: string) {
    const db = getDB();
    if (!(await db.pendingUploads.get(noteId))) return;
    const note = await db.notes.get(noteId);
    if (!isSyncedRow(note)) {
      await db.pendingUploads.delete(noteId);
      return;
    }
    await this.cloud.upload(note);
    await clearPendingUpload(note);
  }
}
