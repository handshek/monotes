import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  MAX_CATCHUP_VERSIONS,
  MAX_NOTE_CHARS,
  MAX_PUSH_ARG_BYTES,
  MAX_PUSH_UPDATES,
  RESTORE_CLIENT_ID,
  STEPS_PAGE_BYTES,
  STEPS_PAGE_SIZE,
  composeDescs,
  isHumanClientId,
  lateHumanOverlap,
  normalizeLineEndings,
  parseChanges,
  rebaseSubmitted,
  replaceAll,
  toText,
  utf8Length,
  type SubmittedUpdate,
} from "./lib/collabCore";
import {
  HistoryError,
  HistoryLimitError,
  appendBatch,
  batchBytes,
  checkpointBody,
  connectionNames,
  findOwnedNote,
  insertCheckpoint,
  isCollabNote,
  loadUpdates,
  measureBatch,
  removeGrantsForNote,
  textAtVersion,
} from "./lib/history";

const NOTE_ID_PATTERN = /^[0-9A-Za-z]{10}$/;

const isAgentClient = (clientId: string) => clientId.startsWith("agent:");

/*
 * Whether a note exists in the cloud and whether it is connected. Kept to
 * metadata so a subscription never resends the note's text; fetch the text
 * once with openContent when it is needed.
 */
export const openInfo = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!note) return { status: "missing" as const };
    if (note.deletedAt) return { status: "deleted" as const, collab: Boolean(note.collab) };
    return { status: "ok" as const, epoch: note.collab?.epoch ?? null };
  },
});

/* The note's text, for a one-time copy onto this device. */
export const openContent = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!note || note.deletedAt) return null;
    return { content: note.content, updatedAt: note.updatedAt, epoch: note.collab?.epoch ?? null };
  },
});

export const head = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!note) return { status: "missing" as const };
    if (note.deletedAt) return { status: "deleted" as const };
    if (!isCollabNote(note)) return { status: "not_collab" as const };
    return { status: "ok" as const, epoch: note.collab.epoch, version: note.collab.version };
  },
});

export const snapshot = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!note) return { status: "missing" as const };
    if (note.deletedAt) return { status: "deleted" as const };
    if (!isCollabNote(note)) return { status: "not_collab" as const };
    return {
      status: "ok" as const,
      epoch: note.collab.epoch,
      version: note.collab.version,
      text: note.content,
    };
  },
});

export const stepsSince = query({
  args: { noteId: v.string(), epoch: v.string(), since: v.number() },
  handler: async (ctx, { noteId, epoch, since }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!note) return { status: "missing" as const };
    if (note.deletedAt) return { status: "deleted" as const };
    if (!isCollabNote(note)) return { status: "not_collab" as const };
    if (note.collab.epoch !== epoch) return { status: "epoch_changed" as const };
    if (!Number.isSafeInteger(since) || since < 0 || since > note.collab.version) {
      return { status: "invalid_base" as const };
    }
    // Read lazily within a row and byte budget; the client asks again from
    // the last version it received.
    const batches = [];
    let bytes = 0;
    for await (const batch of ctx.db
      .query("noteSteps")
      .withIndex("by_note_to", (q) => q.eq("note", note._id).gt("toVersion", since))
      .order("asc")) {
      bytes += batchBytes(batch);
      if (batches.length > 0 && (batches.length >= STEPS_PAGE_SIZE || bytes > STEPS_PAGE_BYTES)) break;
      batches.push(batch);
    }
    const agentIds = batches.flatMap((batch) =>
      batch.author.kind === "agent" ? [batch.author.connectionId] : [],
    );
    const names = await connectionNames(ctx, agentIds);
    return {
      status: "ok" as const,
      version: note.collab.version,
      batches: batches.map((batch) => {
        const skip = Math.max(0, since - batch.fromVersion);
        return {
          fromVersion: batch.fromVersion + skip,
          toVersion: batch.toVersion,
          clientId: batch.clientId,
          author:
            batch.author.kind === "agent"
              ? { kind: "agent" as const, name: names.get(batch.author.connectionId) ?? "Agent" }
              : { kind: batch.author.kind },
          updates: batch.updates.slice(skip).map((update) => update.changes),
          createdAt: batch.createdAt,
        };
      }),
    };
  },
});

export const pushUpdates = mutation({
  args: {
    noteId: v.string(),
    epoch: v.string(),
    clientId: v.string(),
    baseVersion: v.number(),
    updates: v.array(v.object({ seq: v.number(), changes: v.string() })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "error" as const, code: "signed_out" as const };
    if (!isHumanClientId(args.clientId)) return { status: "error" as const, code: "invalid_update" as const };
    if (
      args.updates.length === 0 ||
      args.updates.length > MAX_PUSH_UPDATES ||
      args.updates.reduce((total, update) => total + utf8Length(update.changes), 0) > MAX_PUSH_ARG_BYTES
    ) {
      return { status: "error" as const, code: "too_large" as const };
    }
    const note = await findOwnedNote(ctx, userId, args.noteId);
    if (!note) return { status: "error" as const, code: "missing" as const };
    if (note.deletedAt) return { status: "error" as const, code: "deleted" as const };
    if (!isCollabNote(note)) return { status: "error" as const, code: "not_collab" as const };
    if (note.collab.epoch !== args.epoch) return { status: "error" as const, code: "epoch_changed" as const };
    const current = note.collab.version;
    if (!Number.isSafeInteger(args.baseVersion) || args.baseVersion < 0 || args.baseVersion > current) {
      return { status: "error" as const, code: "invalid_base" as const };
    }
    if (current - args.baseVersion > MAX_CATCHUP_VERSIONS) {
      return { status: "error" as const, code: "too_far_behind" as const };
    }
    const submitted: SubmittedUpdate[] = [];
    for (const update of args.updates) {
      const changes = parseChanges(update.changes);
      if (!changes || !Number.isSafeInteger(update.seq) || update.seq < 1) {
        return { status: "error" as const, code: "invalid_update" as const };
      }
      submitted.push({ seq: update.seq, changes });
    }

    let over;
    try {
      over = await loadUpdates(ctx, note._id, args.baseVersion, current);
    } catch (error) {
      if (error instanceof HistoryLimitError) return { status: "error" as const, code: "too_far_behind" as const };
      throw error;
    }
    const currentText = toText(note.content);
    const baseLength = composeDescs(over)?.length ?? currentText.length;
    const client = await ctx.db
      .query("collabClients")
      .withIndex("by_note_client", (q) => q.eq("note", note._id).eq("clientId", args.clientId))
      .first();
    const rebased = rebaseSubmitted(args.clientId, baseLength, submitted, over, client?.lastSeq ?? 0);
    if (!rebased.ok) return { status: "error" as const, code: rebased.code };
    if (rebased.accepted.length === 0) return { status: "ok" as const, version: current };

    let newLength = currentText.length;
    for (const update of rebased.accepted) {
      if (update.changes.length !== newLength) return { status: "error" as const, code: "invalid_update" as const };
      newLength = update.changes.newLength;
    }
    // Only the batch's end result must fit: a paste and the edit that undoes
    // it can be accepted together. Over the limit, the client waits for a
    // later edit that shortens the note.
    if (newLength > MAX_NOTE_CHARS) return { status: "error" as const, code: "note_too_long" as const };
    // One stored batch must fit in a document. Several updates can be sent
    // again in smaller batches; a single update that doesn't fit never will.
    if (!measureBatch(rebased.accepted).fits) {
      return {
        status: "error" as const,
        code: rebased.accepted.length > 1 ? ("batch_too_large" as const) : ("too_large" as const),
      };
    }

    const overlapped = lateHumanOverlap(over, rebased.accepted, isAgentClient);
    const { version } = await appendBatch(
      ctx,
      note,
      { clientId: args.clientId, author: { kind: "user" }, updates: rebased.accepted },
      currentText,
    );
    const lastSeq = rebased.accepted[rebased.accepted.length - 1].seq;
    if (client) await ctx.db.patch(client._id, { lastSeq });
    else await ctx.db.insert("collabClients", { note: note._id, clientId: args.clientId, lastSeq });

    if (overlapped) {
      // Keep the writer's own view (base plus everything it submitted) so
      // the merged result can be compared with what was intended.
      let checkpointId;
      try {
        let draft = await textAtVersion(
          ctx,
          { ...note, collab: { ...note.collab, version: current }, content: currentText.toString() },
          args.baseVersion,
        );
        for (const update of submitted) draft = update.changes.apply(draft);
        if (draft.length > MAX_NOTE_CHARS) throw new HistoryError("Draft too large to keep");
        checkpointId = await insertCheckpoint(ctx, {
          note: note._id,
          version,
          text: draft.toString(),
          kind: "aside",
          reason: "late_overlap_draft",
          createdAt: Date.now(),
        });
      } catch (error) {
        // The merge itself is already valid; only the comparison copy is lost.
        if (!(error instanceof HistoryError)) throw error;
      }
      await ctx.db.insert("noteActivity", {
        note: note._id,
        kind: "late_overlap",
        fromVersion: current,
        toVersion: version,
        checkpointId,
        createdAt: Date.now(),
      });
    }
    return { status: "ok" as const, version };
  },
});

/*
 * Connect a note for live agent editing. If a different cloud copy already
 * exists, nothing is chosen until the person picks one; the other text is
 * kept as a checkpoint.
 */
export const enable = mutation({
  args: {
    noteId: v.string(),
    localText: v.string(),
    choice: v.optional(v.union(v.literal("local"), v.literal("cloud"))),
    expectedCloudUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    if (!NOTE_ID_PATTERN.test(args.noteId)) return { status: "invalid" as const };
    const localText = normalizeLineEndings(args.localText);
    if (localText.length > MAX_NOTE_CHARS) return { status: "too_large" as const };
    const existing = await findOwnedNote(ctx, userId, args.noteId);
    if (existing?.collab) {
      if (existing.deletedAt) return { status: "deleted" as const };
      return {
        status: "already_enabled" as const,
        epoch: existing.collab.epoch,
        version: existing.collab.version,
        text: existing.content,
      };
    }
    const cloud = existing && !existing.deletedAt
      ? { text: normalizeLineEndings(existing.content), updatedAt: existing.updatedAt }
      : null;
    const diverged = cloud !== null && cloud.text !== localText;
    if (cloud && diverged) {
      if (!args.choice) {
        return { status: "needs_choice" as const, cloudText: cloud.text, cloudUpdatedAt: cloud.updatedAt };
      }
      if (args.expectedCloudUpdatedAt !== cloud.updatedAt) {
        return { status: "cloud_changed" as const, cloudText: cloud.text, cloudUpdatedAt: cloud.updatedAt };
      }
    }
    const chosen = cloud && diverged && args.choice === "cloud" ? cloud.text : localText;
    // The chosen copy (possibly an older cloud copy) must fit before anything is written.
    if (chosen.length > MAX_NOTE_CHARS) return { status: "too_large" as const };
    const now = Date.now();
    const epoch = crypto.randomUUID();
    const collab = { epoch, version: 0, enabledAt: now };
    let note: Id<"notes">;
    if (existing) {
      await ctx.db.patch(existing._id, { content: chosen, updatedAt: now, deletedAt: undefined, collab });
      note = existing._id;
    } else {
      note = await ctx.db.insert("notes", { userId, noteId: args.noteId, content: chosen, updatedAt: now, collab });
    }
    await insertCheckpoint(ctx, {
      note,
      version: 0,
      text: chosen,
      kind: "base",
      reason: "enabled",
      createdAt: now,
    });
    if (cloud && diverged) {
      await insertCheckpoint(ctx, {
        note,
        version: 0,
        text: args.choice === "cloud" ? localText : cloud.text,
        kind: "aside",
        reason: "unchosen_copy",
        createdAt: now,
      });
    }
    await ctx.db.insert("noteActivity", { note, kind: "enabled", fromVersion: 0, toVersion: 0, createdAt: now });
    return { status: "enabled" as const, epoch, version: 0, text: chosen };
  },
});

export const activity = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!isCollabNote(note) || note.deletedAt) return [];
    const items = await ctx.db
      .query("noteActivity")
      .withIndex("by_note", (q) => q.eq("note", note._id))
      .order("desc")
      .take(50);
    const names = await connectionNames(
      ctx,
      items.flatMap((item) => (item.connectionId ? [item.connectionId] : [])),
    );
    return items.map((item) => ({
      id: item._id,
      kind: item.kind,
      agentName: item.connectionId ? names.get(item.connectionId) ?? "Agent" : null,
      fromVersion: item.fromVersion,
      toVersion: item.toVersion,
      checkpointId: item.checkpointId ?? null,
      createdAt: item.createdAt,
    }));
  },
});

export const checkpoints = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!isCollabNote(note) || note.deletedAt) return [];
    const items = await ctx.db
      .query("noteCheckpoints")
      .withIndex("by_note", (q) => q.eq("note", note._id))
      .order("desc")
      .take(100);
    const names = await connectionNames(
      ctx,
      items.flatMap((item) => (item.connectionId ? [item.connectionId] : [])),
    );
    return items
      .filter((item) => item.reason !== "periodic")
      .map((item) => ({
        id: item._id,
        version: item.version,
        kind: item.kind,
        reason: item.reason,
        agentName: item.connectionId ? names.get(item.connectionId) ?? "Agent" : null,
        createdAt: item.createdAt,
      }));
  },
});

export const checkpointText = query({
  args: { noteId: v.string(), checkpointId: v.id("noteCheckpoints") },
  handler: async (ctx, { noteId, checkpointId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!isCollabNote(note) || note.deletedAt) return null;
    const checkpoint = await ctx.db.get(checkpointId);
    if (!checkpoint || checkpoint.note !== note._id) return null;
    return { text: await checkpointBody(ctx, checkpoint), version: checkpoint.version, reason: checkpoint.reason };
  },
});

/* Text as accepted at a given version, e.g. right after an agent edit. */
export const versionText = query({
  args: { noteId: v.string(), version: v.number() },
  handler: async (ctx, { noteId, version }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!isCollabNote(note) || note.deletedAt) return null;
    if (!Number.isSafeInteger(version) || note.collab.version - version > MAX_CATCHUP_VERSIONS) return null;
    try {
      return { text: (await textAtVersion(ctx, note, version)).toString(), version };
    } catch (error) {
      if (error instanceof HistoryError) return null;
      throw error;
    }
  },
});

/*
 * Restore a checkpoint's text as a new revision. The caller states the
 * version it previewed; anything accepted since then makes the preview
 * stale and nothing is changed.
 */
export const restoreCheckpoint = mutation({
  args: {
    noteId: v.string(),
    epoch: v.string(),
    checkpointId: v.id("noteCheckpoints"),
    expectedVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const note = await findOwnedNote(ctx, userId, args.noteId);
    if (!isCollabNote(note) || note.deletedAt) return { status: "missing" as const };
    if (note.collab.epoch !== args.epoch) return { status: "stale" as const, version: note.collab.version };
    if (note.collab.version !== args.expectedVersion) {
      return { status: "stale" as const, version: note.collab.version };
    }
    const checkpoint = await ctx.db.get(args.checkpointId);
    if (!checkpoint || checkpoint.note !== note._id) return { status: "missing" as const };
    const current = toText(note.content);
    const target = await checkpointBody(ctx, checkpoint);
    if (target.length > MAX_NOTE_CHARS) return { status: "too_large" as const };
    const changes = replaceAll(current, target);
    if (changes.empty) return { status: "unchanged" as const, version: note.collab.version };
    if (!measureBatch([{ seq: 0, changes }]).fits) return { status: "too_large" as const };
    const before = note.collab.version;
    const savedId = await insertCheckpoint(ctx, {
      note: note._id,
      version: before,
      text: note.content,
      kind: "base",
      reason: "before_restore",
      createdAt: Date.now(),
    });
    const { version } = await appendBatch(
      ctx,
      note,
      { clientId: RESTORE_CLIENT_ID, author: { kind: "restore" }, updates: [{ seq: 0, changes }] },
      current,
    );
    await ctx.db.insert("noteActivity", {
      note: note._id,
      kind: "restore",
      fromVersion: before,
      toVersion: version,
      checkpointId: savedId,
      createdAt: Date.now(),
    });
    return { status: "ok" as const, version };
  },
});

/*
 * Delete a note's cloud copy. A connected note keeps its collaboration
 * marker as a tombstone so late or legacy writes cannot bring it back, and
 * every agent grant on it is removed in the same transaction.
 */
export const deleteCloudNote = mutation({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!note) return { status: "missing" as const };
    if (!note.deletedAt) await ctx.db.patch(note._id, { deletedAt: Date.now() });
    await removeGrantsForNote(ctx, note._id);
    return { status: "deleted" as const };
  },
});
