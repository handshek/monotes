/*
 * Internal functions behind the agent HTTP API. Every function rechecks the
 * connection and its grant inside its own transaction, so a revocation or
 * grant change can never be bypassed by a request that started earlier.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { RATE_LIMIT_PER_WINDOW, RATE_WINDOW_MS } from "./lib/agentAuth";
import {
  MAX_CATCHUP_VERSIONS,
  MAX_NOTE_CHARS,
  agentClientId,
  composeDescs,
  formatVersionToken,
  noteTitle,
  parseVersionToken,
  resolveAgentEdits,
  staleEditConflicts,
  toText,
  type AgentEdit,
} from "./lib/collabCore";
import {
  HistoryError,
  HistoryLimitError,
  appendBatch,
  findOwnedNote,
  insertCheckpoint,
  isCollabNote,
  loadUpdates,
  measureBatch,
  textAtVersion,
  type CollabNote,
} from "./lib/history";

export type ApiResult = { status: number; body: Record<string, unknown> };

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): ApiResult {
  return { status, body: { error: { code, message, ...extra } } };
}

// Notes per page when listing. Each note read can be up to ~600 KB of text,
// so pages stay small and the agent follows nextCursor for more.
const LIST_PAGE_SIZE = 10;
// Receipts let a retried requestId get the same answer. A receipt is removed
// after this long; a later retry of an already-applied edit then overlaps
// its own earlier change and is refused as a conflict, never applied twice.
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const RECEIPTS_PRUNED_PER_REQUEST = 20;

export const authenticate = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const connection = await ctx.db
      .query("agentConnections")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!connection || connection.revokedAt) return { ok: false as const, code: "unauthorized" as const };
    const now = Date.now();
    const windowStart = now - (now % RATE_WINDOW_MS);
    const window = await ctx.db
      .query("agentRateWindows")
      .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
      .first();
    if (window && window.windowStart === windowStart) {
      if (window.count >= RATE_LIMIT_PER_WINDOW) {
        return {
          ok: false as const,
          code: "rate_limited" as const,
          retryAfterSeconds: Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000),
        };
      }
      await ctx.db.patch(window._id, { count: window.count + 1 });
    } else if (window) {
      await ctx.db.patch(window._id, { windowStart, count: 1 });
    } else {
      await ctx.db.insert("agentRateWindows", { connectionId: connection._id, windowStart, count: 1 });
    }
    if (!connection.lastUsedAt || now - connection.lastUsedAt > RATE_WINDOW_MS) {
      await ctx.db.patch(connection._id, { lastUsedAt: now });
    }
    return { ok: true as const, connectionId: connection._id, name: connection.name };
  },
});

async function activeConnection(ctx: QueryCtx, connectionId: Id<"agentConnections">) {
  const connection = await ctx.db.get(connectionId);
  return connection && !connection.revokedAt ? connection : null;
}

type GrantedNote = { note: CollabNote; grant: Doc<"agentGrants"> };

/* A note is visible to an agent only through an explicit grant on a live connected note. */
async function grantedNote(
  ctx: QueryCtx,
  connection: Doc<"agentConnections">,
  noteId: string,
): Promise<GrantedNote | null> {
  const note = await findOwnedNote(ctx, connection.userId, noteId);
  if (!isCollabNote(note) || note.deletedAt) return null;
  const grant = await ctx.db
    .query("agentGrants")
    .withIndex("by_connection_note", (q) => q.eq("connectionId", connection._id).eq("note", note._id))
    .first();
  return grant ? { note, grant } : null;
}

function describe(note: CollabNote, access: Doc<"agentGrants">["access"]) {
  return {
    id: note.noteId,
    title: noteTitle(note.content),
    access,
    version: formatVersionToken(note.collab.epoch, note.collab.version),
    updatedAt: new Date(note.updatedAt).toISOString(),
    length: note.content.length,
  };
}

export const me = internalQuery({
  args: { connectionId: v.id("agentConnections") },
  handler: async (ctx, { connectionId }): Promise<ApiResult> => {
    const connection = await activeConnection(ctx, connectionId);
    if (!connection) return apiError(401, "unauthorized", "This agent key is not valid.");
    const grants = await ctx.db
      .query("agentGrants")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect();
    return { status: 200, body: { agent: { id: connection._id, name: connection.name }, grantedNotes: grants.length } };
  },
});

/*
 * One page of the notes shared with this agent, in the order they were
 * shared. With a query, only matching notes on the page are returned; keep
 * following nextCursor to search the rest.
 */
export const listNotes = internalQuery({
  args: {
    connectionId: v.id("agentConnections"),
    query: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { connectionId, query, cursor }): Promise<ApiResult> => {
    const connection = await activeConnection(ctx, connectionId);
    if (!connection) return apiError(401, "unauthorized", "This agent key is not valid.");
    let page;
    try {
      page = await ctx.db
        .query("agentGrants")
        .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
        .paginate({ numItems: LIST_PAGE_SIZE, cursor });
    } catch {
      return apiError(400, "invalid_cursor", "cursor must be a nextCursor value from a previous response.");
    }
    const needle = query?.trim().toLowerCase() ?? "";
    const notes = [];
    for (const grant of page.page) {
      const note = await ctx.db.get(grant.note);
      if (!isCollabNote(note) || note.deletedAt || note.userId !== connection.userId) continue;
      if (needle && !note.content.toLowerCase().includes(needle)) continue;
      notes.push(describe(note, grant.access));
    }
    return { status: 200, body: { notes, nextCursor: page.isDone ? null : page.continueCursor } };
  },
});

/*
 * Read a note. The first successful read through a grant is recorded in the
 * same transaction that checked it, as proof that the connection works; a
 * pairing for this note becomes connected only then.
 */
export const readNote = internalMutation({
  args: { connectionId: v.id("agentConnections"), noteId: v.string() },
  handler: async (ctx, { connectionId, noteId }): Promise<ApiResult> => {
    const connection = await activeConnection(ctx, connectionId);
    if (!connection) return apiError(401, "unauthorized", "This agent key is not valid.");
    const granted = await grantedNote(ctx, connection, noteId);
    if (!granted) return apiError(404, "not_found", "No note with this id is shared with this agent.");
    const now = Date.now();
    if (!granted.grant.firstReadAt) await ctx.db.patch(granted.grant._id, { firstReadAt: now });
    if (!connection.verifiedAt) await ctx.db.patch(connection._id, { verifiedAt: now });
    if (connection.pairingId) {
      const pairing = await ctx.db.get(connection.pairingId);
      if (pairing && !pairing.verifiedAt && pairing.connectionId === connection._id && pairing.note === granted.note._id) {
        await ctx.db.patch(pairing._id, { verifiedAt: now });
      }
    }
    return { status: 200, body: { note: { ...describe(granted.note, granted.grant.access), content: granted.note.content } } };
  },
});

const editValidator = v.union(
  v.object({ type: v.literal("replace"), old: v.string(), new: v.string() }),
  v.object({ type: v.literal("append"), text: v.string() }),
);

export const applyEdits = internalMutation({
  args: {
    connectionId: v.id("agentConnections"),
    noteId: v.string(),
    requestId: v.string(),
    payloadHash: v.string(),
    version: v.string(),
    edits: v.array(editValidator),
  },
  handler: async (ctx, args): Promise<ApiResult> => {
    const connection = await activeConnection(ctx, args.connectionId);
    if (!connection) return apiError(401, "unauthorized", "This agent key is not valid.");
    // Access is checked against the note's current state before anything,
    // including a replayed earlier result, can be returned. A cached result
    // is only replayed while the connection still holds edit access, so a
    // removed grant or deleted note never discloses stored content.
    const granted = await grantedNote(ctx, connection, args.noteId);
    if (!granted) return apiError(404, "not_found", "No note with this id is shared with this agent.");
    if (granted.grant.access !== "edit") {
      return apiError(403, "read_only", "This agent can read this note but not edit it.");
    }
    const previous = await ctx.db
      .query("agentRequests")
      .withIndex("by_connection_request", (q) =>
        q.eq("connectionId", args.connectionId).eq("requestId", args.requestId),
      )
      .first();
    if (previous) {
      if (previous.payloadHash !== args.payloadHash) {
        return apiError(409, "request_id_reused", "This requestId was already used for a different edit. Use a new requestId.");
      }
      const receipt: Record<string, unknown> = JSON.parse(previous.body);
      if (previous.status !== 200) return { status: previous.status, body: receipt };
      // Same outcome as the first time, with the note as it is now.
      return {
        status: 200,
        body: { note: { ...describe(granted.note, "edit"), content: granted.note.content }, ...receipt, replayed: true },
      };
    }
    const { result, receipt } = await attemptEdits(ctx, connection, granted.note, args);
    const now = Date.now();
    await ctx.db.insert("agentRequests", {
      connectionId: args.connectionId,
      requestId: args.requestId,
      payloadHash: args.payloadHash,
      status: result.status,
      body: JSON.stringify(receipt),
      createdAt: now,
    });
    const expired = await ctx.db
      .query("agentRequests")
      .withIndex("by_connection_created", (q) =>
        q.eq("connectionId", args.connectionId).lt("createdAt", now - RECEIPT_TTL_MS),
      )
      .take(RECEIPTS_PRUNED_PER_REQUEST);
    for (const old of expired) await ctx.db.delete(old._id);
    return result;
  },
});

async function attemptEdits(
  ctx: MutationCtx,
  connection: Doc<"agentConnections">,
  note: CollabNote,
  args: { version: string; edits: AgentEdit[] },
): Promise<{ result: ApiResult; receipt: Record<string, unknown> }> {
  const outcome = await resolveEdits(ctx, connection, note, args);
  return "receipt" in outcome ? outcome : { result: outcome, receipt: outcome.body };
}

/* Returns an error result, or the success result with its compact receipt. */
async function resolveEdits(
  ctx: MutationCtx,
  connection: Doc<"agentConnections">,
  note: CollabNote,
  args: { version: string; edits: AgentEdit[] },
): Promise<ApiResult | { result: ApiResult; receipt: Record<string, unknown> }> {
  const current = note.collab.version;
  const currentToken = formatVersionToken(note.collab.epoch, current);
  const base = parseVersionToken(args.version);
  if (!base) return apiError(400, "invalid_version", "version must be the token returned when the note was read.");
  if (base.epoch !== note.collab.epoch || base.version > current) {
    return apiError(409, "version_gone", "That version no longer applies. Read the note again.", { currentVersion: currentToken });
  }
  if (current - base.version > MAX_CATCHUP_VERSIONS) {
    return apiError(409, "base_too_old", "That version is too old. Read the note again.", { currentVersion: currentToken });
  }
  let baseText;
  let intervening;
  try {
    baseText = await textAtVersion(ctx, note, base.version);
    intervening = composeDescs(await loadUpdates(ctx, note._id, base.version, current));
  } catch (error) {
    if (error instanceof HistoryLimitError) {
      return apiError(409, "base_too_old", "That version is too old. Read the note again.", { currentVersion: currentToken });
    }
    if (error instanceof HistoryError) {
      return apiError(409, "version_gone", "That version can't be reconstructed. Read the note again.", { currentVersion: currentToken });
    }
    throw error;
  }
  const resolved = resolveAgentEdits(baseText, args.edits);
  if (!resolved.ok) {
    switch (resolved.code) {
      case "not_found":
        return apiError(422, "not_found_in_note", `edits[${resolved.index}].old was not found in the note at that version.`, { index: resolved.index });
      case "ambiguous":
        return apiError(422, "ambiguous_match", `edits[${resolved.index}].old matches more than once. Include more surrounding text so it matches exactly once.`, { index: resolved.index });
      case "overlapping_edits":
        return apiError(422, "overlapping_edits", "Edits in one request must not overlap, and at most one append is allowed.", { index: resolved.index });
      case "too_large":
        return apiError(413, "note_too_large", "The note would exceed the maximum note size.");
    }
  }
  if (staleEditConflicts(resolved.ranges, intervening)) {
    return apiError(409, "conflict", "Someone changed this part of the note after you read it. Read the note again and redo the edit against the new text.", { currentVersion: currentToken });
  }
  const changes = intervening ? resolved.changes.map(intervening) : resolved.changes;
  // The base result fit, but newer text elsewhere may push the merged note
  // over the limit. Check before writing anything.
  if (changes.newLength > MAX_NOTE_CHARS || !measureBatch([{ seq: 0, changes }]).fits) {
    return apiError(413, "note_too_large", "The note would exceed the maximum note size.");
  }
  const currentText = toText(note.content);
  const checkpointId = await insertCheckpoint(ctx, {
    note: note._id,
    version: current,
    text: note.content,
    kind: "base",
    reason: "before_agent_edit",
    connectionId: connection._id,
    createdAt: Date.now(),
  });
  const { version } = await appendBatch(
    ctx,
    note,
    { clientId: agentClientId(connection._id), author: { kind: "agent", connectionId: connection._id }, updates: [{ seq: 0, changes }] },
    currentText,
  );
  await ctx.db.insert("noteActivity", {
    note: note._id,
    kind: "agent_edit",
    connectionId: connection._id,
    fromVersion: current,
    toVersion: version,
    checkpointId,
    createdAt: Date.now(),
  });
  const receipt = { applied: args.edits.length, appliedVersion: formatVersionToken(note.collab.epoch, version) };
  return {
    result: { status: 200, body: { note: { ...describe(note, "edit"), content: note.content }, ...receipt } },
    receipt,
  };
}
