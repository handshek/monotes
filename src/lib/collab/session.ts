/*
 * One tab's live collaboration on one connected note.
 *
 * The server is the authority. This client keeps the text and version the
 * server last confirmed, plus local updates it has not confirmed. That state
 * is written to IndexedDB before any update is sent (write-ahead), so a
 * reload resends exactly the same numbered updates and the server drops the
 * ones it already accepted. Remote updates enter the editor as CodeMirror
 * transactions; the document is never replaced wholesale.
 */
import { ChangeSet, Text, Transaction } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { getSyncedVersion, receiveUpdates, sendableUpdates, type Update } from "@codemirror/collab";
import {
  CLIENT_EXTENDED_BATCH_BYTES,
  CLIENT_PUSH_BATCH_BYTES,
  CLIENT_PUSH_UPDATES,
  MAX_NOTE_CHARS,
  MAX_PUSH_UPDATES,
  replaceAll,
  storedUpdateBytes,
  toText,
} from "../../../convex/lib/collabCore";
import { getDB, type CollabClientRecord, type RecoveryRecord, type StoredUpdate } from "@/lib/local-db";
import { addAgentMarks, agentMarkId, clearAgentMarks } from "./agent-marks";
import { addRecovery, deleteClient, listClients, queuedText, saveClientState } from "./store";
import { claimClientId, withOrphanLock, type ClientIdentity } from "./tab-identity";
import type { CollabTransport, HeadResult, PushResult, SnapshotResult, StepsResult } from "./transport";

type StepBatches = Extract<StepsResult, { status: "ok" }>["batches"];
type SessionDraft = { epoch: string; version: number; text: string };

const DRAFT_PREFIX = "monotes-collab-draft:";
const SNAPSHOT_TIMEOUT_MS = 6_000;
const AGENT_MARK_MS = 10_000;
const MAX_RETRY_MS = 30_000;
// A rejected send (the server threw) is retried a few times in case it was
// transient, then sending stops until the person asks to try again.
const MAX_SEND_FAILURES = 4;
// Explicit saves and restores wait at most this long for the server.
export const FLUSH_SETTLE_MS = 3_000;
const MIN_BATCH_BYTES = 32 * 1024;
const ORPHAN_RETRY_MS = 5_000;

export type Connection = "connecting" | "live" | "offline" | "signed_out" | "deleted" | "unavailable";

export interface SessionStatus {
  connection: Connection;
  pending: number;
  storageError: boolean;
  problem: SendProblem | null;
}

/*
 * Why this tab's changes aren't being sent:
 * - note_too_long: the note is over the length limit; sending resumes by
 *   itself once a later edit (an undo, a deletion) brings it back under.
 * - too_large: one change is too big to ever store; start again to continue.
 * - queue_too_large: the note only fits again after more changes than one
 *   request can carry; start again to continue.
 * - rejected: the server keeps refusing sends; try again.
 */
export type SendProblem = "note_too_long" | "too_large" | "queue_too_large" | "rejected";

type BlockReason = Exclude<SendProblem, "note_too_long">;

interface UpdateMeta {
  newLength: number;
  bytes: number;
}

type BatchPlan =
  | { kind: "send"; updates: StoredUpdate[]; extended: boolean }
  | { kind: "wait_shorter" }
  | { kind: "unsendable"; reason: "too_large" | "queue_too_large" };

/* Delays, adjustable for tests. */
export interface SessionTiming {
  retryBaseMs: number;
  flushSettleMs: number;
}

const DEFAULT_TIMING: SessionTiming = { retryBaseMs: 1_000, flushSettleMs: FLUSH_SETTLE_MS };

export interface SessionCallbacks {
  onStatus(status: SessionStatus): void;
  onAgentEdit(name: string): void;
  /* The queue could not be merged; its text was kept and the editor must restart. */
  onReset(): void;
}

export type OpenResult =
  | { kind: "ready"; session: CollabSession; doc: string; version: number; clientId: string }
  | { kind: "deleted" }
  | { kind: "epoch_changed"; epoch: string; text: string }
  | { kind: "unavailable"; reason: "offline" | "signed_out" | "missing" };

interface StartState {
  text: string;
  version: number;
  confirmedSeq: number;
  unconfirmed: ChangeSet[];
}

function parseQueue(record: CollabClientRecord): ChangeSet[] | null {
  const changes: ChangeSet[] = [];
  let length = toText(record.text).length;
  for (const [index, update] of record.unconfirmed.entries()) {
    if (update.seq !== record.confirmedSeq + index + 1) return null;
    try {
      const parsed = ChangeSet.fromJSON(JSON.parse(update.changes));
      if (parsed.length !== length) return null;
      length = parsed.newLength;
      changes.push(parsed);
    } catch {
      return null;
    }
  }
  return changes;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export class CollabSession {
  private view: EditorView | null = null;
  private confirmed: Text;
  private confirmedSeq: number;
  private persisted: CollabClientRecord | null = null;
  private ackedSeq = 0;
  private saving: Promise<void> | null = null;
  private saveAgain = false;
  private localChanges = 0;
  private pushing: Promise<void> | null = null;
  private pushAgain = false;
  private pulling: Promise<void> | null = null;
  private pullAgain = false;
  private blocked: BlockReason | null = null;
  private persistedMeta: UpdateMeta[] = [];
  /* Set while waiting for a shorter note; the queue state the server refused. */
  private shorterWaitKey: string | null = null;
  private waitingForShorter = false;
  private sendFailures = 0;
  private batchBudget = CLIENT_PUSH_BATCH_BYTES;
  private deletedHandled = false;
  private orphanRetryScheduled = false;
  private retryDelay: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopHead: (() => void) | null = null;
  private disposed = false;
  private status: SessionStatus = { connection: "connecting", pending: 0, storageError: false, problem: null };
  private restored: ChangeSet[];
  private replaying = false;
  private readonly onOnline = () => {
    this.retryDelay = this.timing.retryBaseMs;
    if (this.status.connection === "offline") this.emit({ connection: "connecting" });
    void this.pushLoop();
    void this.pull();
  };
  private readonly onOffline = () => {
    if (this.status.connection === "live" || this.status.connection === "connecting") this.emit({ connection: "offline" });
  };

  private constructor(
    readonly noteId: string,
    readonly epoch: string,
    private readonly identity: ClientIdentity,
    private readonly transport: CollabTransport,
    private readonly callbacks: SessionCallbacks,
    start: StartState,
    private readonly timing: SessionTiming,
  ) {
    this.retryDelay = timing.retryBaseMs;
    this.confirmed = toText(start.text);
    this.confirmedSeq = start.confirmedSeq;
    this.restored = start.unconfirmed;
  }

  get clientId() {
    return this.identity.clientId;
  }

  static async open(
    noteId: string,
    epoch: string,
    transport: CollabTransport,
    callbacks: SessionCallbacks,
    timing: Partial<SessionTiming> = {},
  ): Promise<OpenResult> {
    const rows = await listClients(noteId);
    let identity = await claimClientId(noteId, (id) =>
      rows.some((row) => row.clientId === id && row.epoch === epoch),
    );
    let start: StartState | null = null;
    const own = rows.find((row) => row.clientId === identity.clientId && row.epoch === epoch);
    if (own) {
      const unconfirmed = parseQueue(own);
      if (unconfirmed) {
        start = { text: own.text, version: own.version, confirmedSeq: own.confirmedSeq, unconfirmed };
      } else {
        await addRecovery(noteId, queuedText(own) ?? own.text, "unmerged");
        await deleteClient(noteId, own.clientId);
        // The server may already hold updates under this id, so new typing
        // must not restart its sequence numbers: take a fresh identity.
        identity.release();
        identity = await claimClientId(noteId, () => false);
      }
    }
    if (!start) {
      const snapshot: SnapshotResult | null = await withTimeout(transport.snapshot(noteId), SNAPSHOT_TIMEOUT_MS).catch(
        () => null,
      );
      if (snapshot?.status === "ok") {
        if (snapshot.epoch !== epoch) {
          identity.release();
          return { kind: "epoch_changed", epoch: snapshot.epoch, text: snapshot.text };
        }
        start = { text: snapshot.text, version: snapshot.version, confirmedSeq: 0, unconfirmed: [] };
      } else if (snapshot?.status === "deleted") {
        identity.release();
        return { kind: "deleted" };
      } else {
        // Offline: start from the newest state another tab on this device confirmed.
        const best = rows
          .filter((row) => row.epoch === epoch && row.clientId !== identity.clientId)
          .sort((a, b) => b.version - a.version)[0];
        if (best) start = { text: best.text, version: best.version, confirmedSeq: 0, unconfirmed: [] };
        else {
          identity.release();
          return {
            kind: "unavailable",
            reason: snapshot?.status === "signed_out" ? "signed_out" : snapshot ? "missing" : "offline",
          };
        }
      }
    }
    const session = new CollabSession(noteId, epoch, identity, transport, callbacks, start, { ...DEFAULT_TIMING, ...timing });
    return { kind: "ready", session, doc: start.text, version: start.version, clientId: identity.clientId };
  }

  /* Connect the editor created from `doc`/`version` and resume. */
  attach(view: EditorView) {
    const draft = this.takeSessionDraft();
    this.view = view;
    this.replaying = true;
    try {
      for (const changes of this.restored) {
        view.dispatch({ changes, annotations: [Transaction.addToHistory.of(false)] });
      }
    } finally {
      this.replaying = false;
    }
    this.restored = [];
    if (draft) this.recoverSessionDraft(draft);
    this.keepOtherSessionDrafts();
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    if (!navigator.onLine) this.status = { ...this.status, connection: "offline" };
    this.stopHead = this.transport.watchHead(this.noteId, (head) => this.onHead(head));
    void this.persist();
    void this.adoptOrphans();
    this.emit();
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    this.stopHead?.();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const pendingSave = this.saving ?? Promise.resolve();
    void pendingSave.finally(() => this.identity.release());
    this.view = null;
  }

  /* Called for every editor update. */
  handleUpdate(update: ViewUpdate) {
    if (!update.docChanged || this.disposed) return;
    if (update.transactions.every((tr) => tr.annotation(Transaction.remote))) return;
    this.localChanges++;
    if (!this.replaying) this.writeSessionDraft();
    void this.persist();
  }

  /*
   * Save locally now, then give the server a bounded time to accept and
   * confirm this tab's updates. Requests still in flight keep running after
   * the wait; offline, this returns as soon as the local save is done.
   */
  async flush(): Promise<{ savedLocally: boolean; pending: number; problem: SendProblem | null }> {
    await this.persist();
    const savedLocally = !this.status.storageError;
    const reachable =
      savedLocally && !this.disposed && navigator.onLine &&
      this.status.connection !== "offline" && this.status.connection !== "signed_out" &&
      this.status.connection !== "deleted" && this.status.connection !== "unavailable";
    if (reachable && this.pendingCount() > 0) {
      if (this.blocked === "rejected") this.retrySending();
      const settle = async () => {
        for (
          let round = 0;
          round < 4 && this.pendingCount() > 0 && !this.disposed && !this.blocked && !this.waitingForShorter;
          round++
        ) {
          await this.pushLoop();
          await this.pull();
        }
      };
      await withTimeout(settle(), this.timing.flushSettleMs);
    }
    return { savedLocally, pending: this.pendingCount(), problem: this.status.problem };
  }

  /* After the server refused sends, try again (for example from a Retry button). */
  retrySending() {
    if (this.blocked !== "rejected") return;
    this.blocked = null;
    this.sendFailures = 0;
    this.retryDelay = this.timing.retryBaseMs;
    this.emit({ problem: null });
    void this.pushLoop();
  }

  /* Keep everything this tab shows as kept text and start again from the server. */
  keepTextAndRestart() {
    void this.reset();
  }

  /* Insert text at the end as an ordinary local edit (used for recovered drafts). */
  appendText(text: string) {
    const view = this.view;
    if (!view || this.status.connection === "deleted") return;
    const doc = view.state.doc;
    const prefix = doc.length && !doc.toString().endsWith("\n") ? "\n" : "";
    view.dispatch({ changes: { from: doc.length, insert: prefix + text } });
  }

  currentText(): string | null {
    return this.view?.state.doc.toString() ?? null;
  }

  syncedVersion(): number | null {
    return this.view ? getSyncedVersion(this.view.state) : null;
  }

  pendingCount(): number {
    return this.view ? sendableUpdates(this.view.state).length : this.restored.length;
  }

  private emit(patch: Partial<SessionStatus> = {}) {
    this.status = { ...this.status, ...patch, pending: this.pendingCount() };
    this.callbacks.onStatus(this.status);
  }

  private draftKey() {
    return `${DRAFT_PREFIX}${this.noteId}:${this.clientId}`;
  }

  /* A synchronous copy of the visible text, kept until IndexedDB has it. */
  private writeSessionDraft() {
    const view = this.view;
    if (!view) return;
    try {
      sessionStorage.setItem(
        this.draftKey(),
        JSON.stringify({ epoch: this.epoch, version: getSyncedVersion(view.state), text: view.state.doc.toString() }),
      );
    } catch {
      // IndexedDB remains the durable copy; a failure there is reported.
    }
  }

  private clearSessionDraft(onlyIfText?: string) {
    try {
      if (onlyIfText !== undefined) {
        const raw = sessionStorage.getItem(this.draftKey());
        // Keep a draft that holds typing newer than what was just stored.
        if (raw && JSON.parse(raw)?.text !== onlyIfText) return;
      }
      sessionStorage.removeItem(this.draftKey());
    } catch {
      // Nothing to clear.
    }
  }

  private takeSessionDraft(): SessionDraft | null {
    let draft: unknown;
    try {
      const raw = sessionStorage.getItem(this.draftKey());
      draft = raw ? JSON.parse(raw) : null;
    } catch {
      draft = null;
    }
    this.clearSessionDraft();
    if (
      typeof draft !== "object" || draft === null ||
      !("epoch" in draft) || !("version" in draft) || !("text" in draft) ||
      draft.epoch !== this.epoch || typeof draft.version !== "number" || typeof draft.text !== "string"
    ) return null;
    return { epoch: draft.epoch, version: draft.version, text: draft.text };
  }

  /*
   * Typing after the last durable save survives a reload in sessionStorage.
   * If it was based on the same confirmed version, re-apply the difference
   * as local typing; otherwise keep it for review rather than guess.
   */
  private recoverSessionDraft(draft: SessionDraft) {
    const view = this.view;
    if (!view) return;
    const current = view.state.doc;
    if (draft.text === current.toString()) return;
    if (draft.version === getSyncedVersion(view.state)) {
      view.dispatch({ changes: replaceAll(current, draft.text) });
    } else {
      void addRecovery(this.noteId, draft.text, "unsaved_typing");
    }
  }

  /*
   * A reload can briefly get a new identity if the old page still held its
   * lock; its last typing then sits under the old id. Keep any such copy in
   * this tab's storage as kept text rather than leaving it hidden.
   */
  private keepOtherSessionDrafts() {
    const view = this.view;
    if (!view) return;
    const prefix = `${DRAFT_PREFIX}${this.noteId}:`;
    const current = view.state.doc.toString();
    try {
      const keys: string[] = [];
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(prefix) && key !== this.draftKey()) keys.push(key);
      }
      for (const key of keys) {
        const raw = sessionStorage.getItem(key);
        sessionStorage.removeItem(key);
        const draft: unknown = raw ? JSON.parse(raw) : null;
        if (
          typeof draft === "object" && draft !== null && "epoch" in draft && "text" in draft &&
          draft.epoch === this.epoch && typeof draft.text === "string" && draft.text !== current
        ) {
          void addRecoveryOnce(this.noteId, draft.text, "unsaved_typing");
        }
      }
    } catch {
      // Unreadable session storage holds nothing to keep.
    }
  }

  private snapshotRecord(): {
    record: CollabClientRecord;
    meta: UpdateMeta[];
    visible: string;
    changeCount: number;
  } | null {
    const view = this.view;
    if (!view) return null;
    const sendable = sendableUpdates(view.state);
    const unconfirmed: StoredUpdate[] = sendable.map((update, index) => ({
      seq: this.confirmedSeq + index + 1,
      changes: JSON.stringify(update.changes.toJSON()),
    }));
    const meta = sendable.map((update, index) => ({
      newLength: update.changes.newLength,
      bytes: storedUpdateBytes(unconfirmed[index].changes),
    }));
    return {
      meta,
      record: {
        noteId: this.noteId,
        clientId: this.clientId,
        epoch: this.epoch,
        version: getSyncedVersion(view.state),
        text: this.confirmed.toString(),
        confirmedSeq: this.confirmedSeq,
        unconfirmed,
        updatedAt: Date.now(),
      },
      visible: view.state.doc.toString(),
      changeCount: this.localChanges,
    };
  }

  /* Serialised saves; a request during a save triggers one more save. */
  private persist(): Promise<void> {
    if (this.saving) {
      this.saveAgain = true;
      return this.saving;
    }
    this.saving = (async () => {
      try {
        do {
          this.saveAgain = false;
          const snapshot = this.snapshotRecord();
          if (!snapshot || this.disposed) break;
          try {
            await saveClientState(snapshot.record, snapshot.visible);
            this.persisted = snapshot.record;
            this.persistedMeta = snapshot.meta;
            if (snapshot.changeCount === this.localChanges) this.clearSessionDraft(snapshot.visible);
            if (this.status.storageError) this.emit({ storageError: false });
          } catch {
            this.emit({ storageError: true });
            return;
          }
        } while (this.saveAgain);
      } finally {
        this.saving = null;
      }
      this.emit();
      void this.pushLoop();
    })();
    return this.saving;
  }

  /*
   * Send the persisted queue. Only durably stored updates are ever sent.
   * Concurrent callers share one run; a call during a run asks for another.
   */
  private pushLoop(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pushing) {
      this.pushAgain = true;
      return this.pushing;
    }
    this.pushing = this.runPushLoop().finally(() => {
      this.pushing = null;
      if (this.pushAgain && !this.disposed) {
        this.pushAgain = false;
        void this.pushLoop();
      }
    });
    return this.pushing;
  }

  /*
   * Choose what to send next. Normally the longest prefix of the queue
   * within the ordinary budgets. If that prefix would leave the note over
   * its length limit, extend it to the first point where the note fits again
   * (a paste and its undo travel together), within the server's budgets.
   * Sequence numbers are never changed; only how many updates are sent.
   */
  private planBatch(record: CollabClientRecord, meta: readonly UpdateMeta[]): BatchPlan {
    const queue = record.unconfirmed;
    if (meta[0].bytes > CLIENT_EXTENDED_BATCH_BYTES) return { kind: "unsendable", reason: "too_large" };
    let end = 0;
    let bytes = 0;
    while (
      end < queue.length &&
      end < CLIENT_PUSH_UPDATES &&
      (end === 0 || bytes + meta[end].bytes <= this.batchBudget)
    ) {
      bytes += meta[end].bytes;
      end++;
    }
    if (meta[end - 1].newLength <= MAX_NOTE_CHARS) {
      return { kind: "send", updates: queue.slice(0, end), extended: false };
    }
    while (end < queue.length && end < MAX_PUSH_UPDATES && bytes + meta[end].bytes <= CLIENT_EXTENDED_BATCH_BYTES) {
      bytes += meta[end].bytes;
      end++;
      if (meta[end - 1].newLength <= MAX_NOTE_CHARS) {
        return { kind: "send", updates: queue.slice(0, end), extended: true };
      }
    }
    // The note fits again only past what one request can carry.
    if (meta.slice(end).some((update) => update.newLength <= MAX_NOTE_CHARS)) {
      return { kind: "unsendable", reason: "queue_too_large" };
    }
    return { kind: "wait_shorter" };
  }

  private setWaitingForShorter(waiting: boolean) {
    if (this.waitingForShorter === waiting) return;
    this.waitingForShorter = waiting;
    if (!this.blocked) this.emit({ problem: waiting ? "note_too_long" : null });
  }

  private async runPushLoop(): Promise<void> {
    while (!this.disposed && !this.blocked) {
      this.pushAgain = false;
      const record = this.persisted;
      if (!record || record.unconfirmed.length === 0) {
        this.setWaitingForShorter(false);
        return;
      }
      const plan = this.planBatch(record, this.persistedMeta);
      if (plan.kind === "unsendable") {
        await this.blockSending(plan.reason);
        return;
      }
      if (plan.kind === "wait_shorter") {
        this.setWaitingForShorter(true);
        return;
      }
      const batch = plan.updates;
      // The server judged this exact queue too long (other people's text
      // counts too); wait until the queue or the confirmed text changes.
      const key = `${record.version}:${record.unconfirmed[record.unconfirmed.length - 1].seq}`;
      if (this.shorterWaitKey === key) return;
      this.shorterWaitKey = null;
      this.setWaitingForShorter(false);
      // Later batches wait until the server's confirmation of this one has
      // been received and stored, so each is sent from a confirmed base.
      if (batch[batch.length - 1].seq <= this.ackedSeq) return;
      let result: PushResult;
      try {
        result = await this.transport.push({
          noteId: this.noteId,
          epoch: this.epoch,
          clientId: this.clientId,
          baseVersion: record.version,
          updates: batch,
        });
      } catch {
        // The server threw rather than answering with a protocol error.
        this.sendFailures++;
        if (this.sendFailures >= MAX_SEND_FAILURES) await this.blockSending("rejected");
        else this.scheduleRetry();
        return;
      }
      if (result.status === "ok") {
        this.ackedSeq = Math.max(this.ackedSeq, batch[batch.length - 1].seq);
        this.sendFailures = 0;
        this.retryDelay = this.timing.retryBaseMs;
        void this.pull();
        continue;
      }
      if (result.code === "note_too_long") {
        this.shorterWaitKey = key;
        this.setWaitingForShorter(true);
        return;
      }
      if (result.code === "batch_too_large" && !plan.extended && batch.length > 1 && this.batchBudget > MIN_BATCH_BYTES) {
        this.batchBudget = Math.max(MIN_BATCH_BYTES, Math.floor(this.batchBudget / 2));
        continue;
      }
      if (result.code === "batch_too_large") {
        await this.blockSending(plan.extended ? "queue_too_large" : "too_large");
        return;
      }
      await this.handlePushError(result.code);
      return;
    }
  }

  /* Stop sending; the queue stays stored and a copy is kept as visible text. */
  private async blockSending(reason: BlockReason) {
    if (this.blocked === reason) return;
    this.blocked = reason;
    const view = this.view;
    if (view) await addRecoveryOnce(this.noteId, view.state.doc.toString(), "unsent");
    this.emit({ problem: reason });
  }

  private scheduleRetry() {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.pushLoop();
    }, this.retryDelay);
    this.retryDelay = Math.min(MAX_RETRY_MS, this.retryDelay * 2);
  }

  private async handlePushError(code: Extract<PushResult, { status: "error" }>["code"]) {
    switch (code) {
      case "signed_out":
        this.emit({ connection: "signed_out" });
        return;
      case "deleted":
        await this.markDeleted();
        return;
      case "too_large":
        await this.blockSending("too_large");
        return;
      case "note_too_long":
      case "batch_too_large":
        // Handled where the batch was chosen.
        return;
      case "missing":
      case "not_collab":
        this.emit({ connection: "unavailable" });
        return;
      default:
        // epoch_changed, invalid_base, too_far_behind, client_state_mismatch,
        // invalid_update: this queue can't be merged safely.
        await this.reset();
    }
  }

  /* Keep everything this tab shows as a recovery copy, then start again from the server. */
  private async reset() {
    const view = this.view;
    if (!view || this.disposed) return;
    const visible = view.state.doc.toString();
    if (visible !== this.confirmed.toString()) await addRecovery(this.noteId, visible, "unmerged");
    this.disposed = true;
    await (this.saving ?? Promise.resolve());
    await deleteClient(this.noteId, this.clientId);
    this.clearSessionDraft();
    this.callbacks.onReset();
  }

  private async markDeleted() {
    // Head, pull and push can all report deletion; handle it once.
    if (this.deletedHandled) return;
    this.deletedHandled = true;
    const view = this.view;
    if (view && this.pendingCount() > 0) await addRecovery(this.noteId, view.state.doc.toString(), "deleted");
    this.emit({ connection: "deleted" });
  }

  private onHead(head: HeadResult) {
    if (this.disposed) return;
    switch (head.status) {
      case "ok": {
        if (head.epoch !== this.epoch) {
          void this.reset();
          return;
        }
        if (this.status.connection !== "live") this.emit({ connection: "live" });
        const view = this.view;
        if (view && head.version > getSyncedVersion(view.state)) void this.pull();
        void this.pushLoop();
        return;
      }
      case "deleted":
        void this.markDeleted();
        return;
      case "signed_out":
        this.emit({ connection: "signed_out" });
        return;
      default:
        this.emit({ connection: "unavailable" });
    }
  }

  /* Fetch and apply accepted updates. Concurrent callers share one run. */
  private pull(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pulling) {
      this.pullAgain = true;
      return this.pulling;
    }
    this.pulling = this.runPull().finally(() => {
      this.pulling = null;
      if (this.pullAgain && !this.disposed) {
        this.pullAgain = false;
        void this.pull();
      }
    });
    return this.pulling;
  }

  private async runPull(): Promise<void> {
    {
      do {
        this.pullAgain = false;
        const view = this.view;
        if (!view || this.disposed) return;
        const since = getSyncedVersion(view.state);
        let result;
        try {
          result = await this.transport.stepsSince(this.noteId, this.epoch, since);
        } catch {
          return;
        }
        if (this.disposed || !this.view) return;
        if (result.status !== "ok") {
          if (result.status === "deleted") await this.markDeleted();
          else if (result.status === "epoch_changed" || result.status === "invalid_base") await this.reset();
          return;
        }
        if (getSyncedVersion(this.view.state) !== since) {
          this.pullAgain = true;
          continue;
        }
        const received = this.decode(result.batches, since);
        if (!received) {
          await this.reset();
          return;
        }
        if (received.updates.length === 0) return;
        this.apply(received);
        if (result.version > since + received.updates.length) this.pullAgain = true;
      } while (this.pullAgain);
    }
  }

  private decode(batches: StepBatches, since: number) {
    const updates: Update[] = [];
    const agents: { index: number; name: string }[] = [];
    let expected = since;
    let confirmed = this.confirmed;
    for (const batch of batches) {
      if (batch.fromVersion !== expected) return null;
      for (const json of batch.updates) {
        let changes: ChangeSet;
        try {
          changes = ChangeSet.fromJSON(JSON.parse(json));
        } catch {
          return null;
        }
        if (changes.length !== confirmed.length) return null;
        confirmed = changes.apply(confirmed);
        if (batch.author.kind === "agent") agents.push({ index: updates.length, name: batch.author.name });
        updates.push({ changes, clientID: batch.clientId });
        expected++;
      }
    }
    return { updates, agents, confirmed };
  }

  private apply({ updates, agents, confirmed }: { updates: Update[]; agents: { index: number; name: string }[]; confirmed: Text }) {
    const view = this.view;
    if (!view) return;
    const own = updates.filter((update) => update.clientID === this.clientId).length;
    view.dispatch(receiveUpdates(view.state, updates));
    this.confirmed = confirmed;
    this.confirmedSeq += own;
    if (agents.length) this.highlight(updates, agents);
    void this.persist();
  }

  /* Map each agent update's inserted ranges forward to the current document. */
  private highlight(updates: Update[], agents: { index: number; name: string }[]) {
    const view = this.view;
    if (!view) return;
    let local: ChangeSet | null = null;
    for (const update of sendableUpdates(view.state)) local = local ? local.compose(update.changes) : update.changes;
    const marks: { id: number; from: number; to: number; name: string }[] = [];
    const id = agentMarkId();
    for (const { index, name } of agents) {
      updates[index].changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        let from = fromB;
        let to = toB;
        for (const later of updates.slice(index + 1)) {
          from = later.changes.mapPos(from, 1);
          to = later.changes.mapPos(to, -1);
        }
        if (local) {
          from = local.mapPos(from, 1);
          to = local.mapPos(to, -1);
        }
        if (to > from) marks.push({ id, from, to, name });
      });
    }
    const names = new Set(agents.map((agent) => agent.name));
    for (const name of names) this.callbacks.onAgentEdit(name);
    if (!marks.length) return;
    view.dispatch({ effects: addAgentMarks.of(marks) });
    setTimeout(() => this.view?.dispatch({ effects: clearAgentMarks.of(id) }), AGENT_MARK_MS);
  }

  /*
   * Send queues left by tabs that are gone. A queue is only replayed while
   * holding its owner's lock; without Web Locks it is offered for review.
   */
  private async adoptOrphans() {
    const candidates = await listClients(this.noteId);
    for (const candidate of candidates) {
      if (candidate.clientId === this.clientId || this.disposed) continue;
      if (!this.identity.locksAvailable) {
        // Its owner may still be open: offer a copy, never replay or delete.
        const text = candidate.unconfirmed.length ? queuedText(candidate) : null;
        if (text) await addRecoveryOnce(this.noteId, text);
        continue;
      }
      const adopted = await withOrphanLock(this.noteId, candidate.clientId, () => this.adoptOrphan(candidate.clientId));
      // A reloading tab may still hold its old lock briefly; look again later.
      if (!adopted && !this.orphanRetryScheduled) {
        this.orphanRetryScheduled = true;
        setTimeout(() => {
          if (!this.disposed) void this.adoptOrphans();
        }, ORPHAN_RETRY_MS);
      }
    }
  }

  /* Runs while holding the orphan's lock, so its row can no longer change. */
  private async adoptOrphan(clientId: string) {
    // Re-read inside the lock: the owner may have saved newer typing
    // between listing the rows and the lock becoming free.
    const row = await getDB().collabClients.get([this.noteId, clientId]);
    if (!row) return;
    const text = row.unconfirmed.length ? queuedText(row) : null;
    const keepForReview = async () => {
      await addRecovery(this.noteId, text ?? row.text, "other_window");
      await deleteClient(this.noteId, row.clientId);
    };
    if (row.unconfirmed.length === 0) {
      await deleteClient(this.noteId, row.clientId);
      return;
    }
    const bytes = row.unconfirmed.reduce((total, update) => total + storedUpdateBytes(update.changes), 0);
    if (row.epoch !== this.epoch || row.unconfirmed.length > CLIENT_PUSH_UPDATES || bytes > CLIENT_PUSH_BATCH_BYTES || !text) {
      // Too large to replay in one atomic request (or no longer applicable):
      // keep the whole text for review rather than replaying part of it.
      await keepForReview();
      return;
    }
    let result: PushResult;
    try {
      result = await this.transport.push({
        noteId: this.noteId,
        epoch: this.epoch,
        clientId: row.clientId,
        baseVersion: row.version,
        updates: row.unconfirmed,
      });
    } catch {
      return; // Offline: the row stays and is tried again on a later load.
    }
    if (result.status === "ok") await deleteClient(this.noteId, row.clientId);
    else if (result.status === "error" && (result.code === "signed_out" || result.code === "missing")) return;
    else await keepForReview();
    void this.pull();
  }
}

async function addRecoveryOnce(noteId: string, text: string, reason: RecoveryRecord["reason"] = "other_window") {
  const existing = await getDB().recoveries.where("noteId").equals(noteId).toArray();
  if (!existing.some((recovery) => recovery.text === text)) await addRecovery(noteId, text, reason);
}
