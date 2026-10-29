import type { Text } from "@codemirror/state";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  CHECKPOINT_INTERVAL,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ROWS,
  MAX_PUSH_UPDATES,
  MAX_STEP_BATCH_BYTES,
  parseChanges,
  replay,
  serializeChanges,
  storedUpdateBytes,
  toText,
  type AcceptedUpdate,
  type SubmittedUpdate,
} from "./collabCore";

export type CollabNote = Doc<"notes"> & { collab: NonNullable<Doc<"notes">["collab"]> };

export function isCollabNote(note: Doc<"notes"> | null): note is CollabNote {
  return Boolean(note?.collab);
}

export async function findOwnedNote(ctx: QueryCtx, userId: Id<"users">, noteId: string) {
  return ctx.db
    .query("notes")
    .withIndex("by_user_and_noteId", (q) => q.eq("userId", userId).eq("noteId", noteId))
    .first();
}

export class HistoryError extends Error {}
/* Thrown when serving a request would read more history than one transaction allows. */
export class HistoryLimitError extends HistoryError {}

const ROW_OVERHEAD_BYTES = 128;

export function batchBytes(batch: Pick<Doc<"noteSteps">, "updates">): number {
  return batch.updates.reduce((total, update) => total + storedUpdateBytes(update.changes), ROW_OVERHEAD_BYTES);
}

/*
 * Serialize a batch and say whether it fits in one stored document. Callers
 * check this before writing anything else, so a refusal leaves no partial
 * writes behind.
 */
export function measureBatch(updates: readonly SubmittedUpdate[]): { serialized: string[]; fits: boolean } {
  const serialized = updates.map((update) => serializeChanges(update.changes));
  const bytes = serialized.reduce((total, changes) => total + storedUpdateBytes(changes), ROW_OVERHEAD_BYTES);
  return { serialized, fits: bytes <= MAX_STEP_BATCH_BYTES };
}

/*
 * Accepted updates with versions in (afterVersion, upToVersion]. Batches are
 * contiguous and hold at most MAX_PUSH_UPDATES updates, so any batch that
 * overlaps the range ends before upToVersion + MAX_PUSH_UPDATES. The index
 * range enforces that bound and rows are read lazily, stopping at the first
 * batch beyond the range or when the row/byte budget is spent.
 */
export async function loadUpdates(
  ctx: QueryCtx,
  note: Id<"notes">,
  afterVersion: number,
  upToVersion: number,
): Promise<AcceptedUpdate[]> {
  if (upToVersion <= afterVersion) return [];
  const rows = ctx.db
    .query("noteSteps")
    .withIndex("by_note_to", (q) =>
      q.eq("note", note).gt("toVersion", afterVersion).lt("toVersion", upToVersion + MAX_PUSH_UPDATES),
    )
    .order("asc");
  const updates: AcceptedUpdate[] = [];
  let rowCount = 0;
  let bytes = 0;
  for await (const batch of rows) {
    if (batch.fromVersion >= upToVersion) break;
    rowCount++;
    bytes += batchBytes(batch);
    if (rowCount > MAX_HISTORY_ROWS || bytes > MAX_HISTORY_BYTES) {
      throw new HistoryLimitError("History range is too large to read at once");
    }
    for (const [index, stored] of batch.updates.entries()) {
      const version = batch.fromVersion + index + 1;
      if (version <= afterVersion || version > upToVersion) continue;
      const changes = parseChanges(stored.changes);
      if (!changes) throw new HistoryError("Stored history is unreadable");
      updates.push({ version, clientId: batch.clientId, seq: stored.seq, changes });
    }
    if (batch.toVersion >= upToVersion) break;
  }
  if (updates.length !== upToVersion - afterVersion) {
    throw new HistoryError("Stored history is incomplete");
  }
  return updates;
}

export async function insertCheckpoint(
  ctx: MutationCtx,
  checkpoint: Omit<Doc<"noteCheckpoints">, "_id" | "_creationTime" | "body" | "textLength"> & { text: string },
): Promise<Id<"noteCheckpoints">> {
  const { text, ...metadata } = checkpoint;
  const body = await ctx.db.insert("noteCheckpointBodies", { text });
  return ctx.db.insert("noteCheckpoints", { ...metadata, body, textLength: text.length });
}

export async function checkpointBody(ctx: QueryCtx, checkpoint: Doc<"noteCheckpoints">): Promise<string> {
  const body = await ctx.db.get(checkpoint.body);
  if (!body) throw new HistoryError("Checkpoint text is missing");
  return body.text;
}

/* Rebuild the exact text at `version` from the nearest earlier base checkpoint. */
export async function textAtVersion(ctx: QueryCtx, note: CollabNote, version: number): Promise<Text> {
  if (version === note.collab.version) return toText(note.content);
  if (version > note.collab.version || version < 0) throw new HistoryError("Unknown version");
  const checkpoint = await ctx.db
    .query("noteCheckpoints")
    .withIndex("by_note_kind_version", (q) =>
      q.eq("note", note._id).eq("kind", "base").lte("version", version),
    )
    .order("desc")
    .first();
  if (!checkpoint) throw new HistoryError("No checkpoint covers this version");
  const updates = await loadUpdates(ctx, note._id, checkpoint.version, version);
  const text = replay(toText(await checkpointBody(ctx, checkpoint)), checkpoint.version, updates, version);
  if (!text) throw new HistoryError("Stored history is inconsistent");
  return text;
}

/* Append accepted updates as one batch and advance the note. */
export async function appendBatch(
  ctx: MutationCtx,
  note: CollabNote,
  batch: {
    clientId: string;
    author: Doc<"noteSteps">["author"];
    updates: readonly SubmittedUpdate[];
  },
  current: Text,
): Promise<{ version: number; text: Text }> {
  if (batch.updates.length === 0 || batch.updates.length > MAX_PUSH_UPDATES) {
    throw new HistoryError("Invalid batch size");
  }
  const { serialized, fits } = measureBatch(batch.updates);
  // Callers measure first; this guards against a caller that didn't.
  if (!fits) throw new HistoryError("Batch exceeds the stored size limit");
  let text = current;
  for (const update of batch.updates) text = update.changes.apply(text);
  const fromVersion = note.collab.version;
  const toVersion = fromVersion + batch.updates.length;
  const now = Date.now();
  await ctx.db.insert("noteSteps", {
    note: note._id,
    fromVersion,
    toVersion,
    clientId: batch.clientId,
    author: batch.author,
    updates: batch.updates.map((update, index) => ({ seq: update.seq, changes: serialized[index] })),
    createdAt: now,
  });
  const content = text.toString();
  await ctx.db.patch(note._id, {
    content,
    updatedAt: now,
    collab: { ...note.collab, version: toVersion },
  });
  if (Math.floor(fromVersion / CHECKPOINT_INTERVAL) < Math.floor(toVersion / CHECKPOINT_INTERVAL)) {
    await insertCheckpoint(ctx, {
      note: note._id,
      version: toVersion,
      text: content,
      kind: "base",
      reason: "periodic",
      createdAt: now,
    });
  }
  note.collab = { ...note.collab, version: toVersion };
  note.content = content;
  note.updatedAt = now;
  return { version: toVersion, text };
}

export async function removeGrantsForNote(ctx: MutationCtx, note: Id<"notes">) {
  const grants = await ctx.db
    .query("agentGrants")
    .withIndex("by_note", (q) => q.eq("note", note))
    .collect();
  for (const grant of grants) await ctx.db.delete(grant._id);
}

export async function connectionNames(
  ctx: QueryCtx,
  ids: Iterable<Id<"agentConnections">>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of new Set(ids)) {
    const connection = await ctx.db.get(id);
    names.set(id, connection?.name ?? "Removed agent");
  }
  return names;
}
