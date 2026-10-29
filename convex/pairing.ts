/*
 * Connecting an agent with a one-time pairing code.
 *
 * The note's owner creates a code for one note, one access level and one
 * agent name. The agent sends the code to POST /agent/v1/pair, which creates
 * that agent's connection and its grant for this note in one transaction and
 * returns the agent's private access file. Only the code's hash is stored.
 * A pairing counts as connected only after the agent actually reads the note.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { grantAccess } from "./schema";
import {
  MAX_CONNECTIONS_PER_USER,
  MAX_PAIRINGS_PER_HOUR,
  MAX_PENDING_PAIRINGS,
  PAIRING_TTL_MS,
  cleanConnectionName,
  cleanSiteOrigin,
  credentialFileName,
  generatePairingCode,
  sha256Hex,
} from "./lib/agentAuth";
import { findOwnedNote, isCollabNote } from "./lib/history";

const HOUR_MS = 60 * 60 * 1000;

type StartResult =
  | { status: "created"; pairingId: Id<"agentPairings">; code: string; expiresAt: number }
  | { status: "already_connected"; pairingId: Id<"agentPairings"> }
  | {
      status:
        | "signed_out"
        | "invalid_name"
        | "invalid_site"
        | "not_connected"
        | "invalid_replace"
        | "access_removed"
        | "too_many_pending"
        | "rate_limited"
        | "too_many_connections";
    };

/*
 * Create a pairing code. The code is returned to the owner's browser once,
 * to put in the setup message; only its hash is kept. `replaces` cancels an
 * earlier pairing from the same setup (the "New code" button) in the same
 * transaction, including a connection it created that never read the note.
 */
export const start = action({
  args: {
    noteId: v.string(),
    name: v.string(),
    access: grantAccess,
    siteOrigin: v.string(),
    replaces: v.optional(v.id("agentPairings")),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" };
    const name = cleanConnectionName(args.name);
    if (!name) return { status: "invalid_name" };
    const siteOrigin = cleanSiteOrigin(args.siteOrigin);
    if (!siteOrigin) return { status: "invalid_site" };
    const code = generatePairingCode();
    const inserted:
      | { status: "created"; pairingId: Id<"agentPairings">; expiresAt: number }
      | Exclude<StartResult, { status: "created" }> =
      await ctx.runMutation(internal.pairing.insert, {
        userId,
        noteId: args.noteId,
        name,
        access: args.access,
        siteOrigin,
        codeHash: await sha256Hex(code),
        replaces: args.replaces,
      });
    if (inserted.status !== "created") return inserted;
    return { status: "created", pairingId: inserted.pairingId, code, expiresAt: inserted.expiresAt };
  },
});

/* Active connections, counted up to the limit; revoked ones aren't read. */
function narrower(a: Doc<"agentGrants">["access"], b: Doc<"agentGrants">["access"]) {
  return a === "read" || b === "read" ? ("read" as const) : ("edit" as const);
}

async function activeConnectionCount(ctx: MutationCtx, userId: Id<"users">) {
  const active = await ctx.db
    .query("agentConnections")
    .withIndex("by_user_revoked", (q) => q.eq("userId", userId).eq("revokedAt", undefined))
    .take(MAX_CONNECTIONS_PER_USER);
  return active.length;
}

async function revokeConnectionAndGrants(ctx: MutationCtx, connectionId: Id<"agentConnections">, now: number) {
  await ctx.db.patch(connectionId, { revokedAt: now });
  const grants = await ctx.db
    .query("agentGrants")
    .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
    .collect();
  for (const grant of grants) await ctx.db.delete(grant._id);
}

/*
 * Cancel a pairing. A code not yet used simply stops working. If the code
 * was used but the agent never read the note (for example its response was
 * lost), the connection that code created is revoked too, so no unused
 * connection or grant is left behind. A connection that did read the note
 * is left alone; removing it is a separate, explicit action.
 */
async function cancelPairing(
  ctx: MutationCtx,
  pairing: Doc<"agentPairings">,
  now: number,
): Promise<"cancelled" | "already_connected"> {
  if (pairing.verifiedAt) return "already_connected";
  if (pairing.status === "redeemed" && pairing.connectionId) {
    const connection = await ctx.db.get(pairing.connectionId);
    if (connection?.verifiedAt) return "already_connected";
    if (connection && !connection.revokedAt) await revokeConnectionAndGrants(ctx, connection._id, now);
  }
  if (pairing.status !== "cancelled") await ctx.db.patch(pairing._id, { status: "cancelled", cancelledAt: now });
  return "cancelled";
}

export const insert = internalMutation({
  args: {
    userId: v.id("users"),
    noteId: v.string(),
    name: v.string(),
    access: grantAccess,
    siteOrigin: v.string(),
    codeHash: v.string(),
    replaces: v.optional(v.id("agentPairings")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const note = await findOwnedNote(ctx, args.userId, args.noteId);
    if (!isCollabNote(note) || note.deletedAt) return { status: "not_connected" as const };
    let { name, access } = args;
    if (args.replaces) {
      // "New code" replaces a setup for this same note only, for the same
      // agent, and never with more access than the person currently allows.
      // If the agent finished connecting first, keep that connection instead.
      const previous = await ctx.db.get(args.replaces);
      if (!previous || previous.userId !== args.userId || previous.note !== note._id) {
        return { status: "invalid_replace" as const };
      }
      // Read the setup's current grant before cancelling removes it: the
      // person may have narrowed or removed it since the code was used.
      let current: Doc<"agentGrants">["access"] | null = previous.access;
      if (previous.status === "redeemed" && previous.connectionId) {
        const connectionId = previous.connectionId;
        const grant = await ctx.db
          .query("agentGrants")
          .withIndex("by_connection_note", (q) => q.eq("connectionId", connectionId).eq("note", previous.note))
          .first();
        current = grant ? narrower(previous.access, grant.access) : null;
      }
      if ((await cancelPairing(ctx, previous, now)) === "already_connected") {
        return { status: "already_connected" as const, pairingId: previous._id };
      }
      if (current === null) return { status: "access_removed" as const };
      name = previous.name;
      access = current;
    }
    const live = await ctx.db
      .query("agentPairings")
      .withIndex("by_user_status_expires", (q) =>
        q.eq("userId", args.userId).eq("status", "pending").gt("expiresAt", now),
      )
      .take(MAX_PENDING_PAIRINGS);
    if (live.length >= MAX_PENDING_PAIRINGS) return { status: "too_many_pending" as const };
    const recent = await ctx.db
      .query("agentPairings")
      .withIndex("by_user_created", (q) => q.eq("userId", args.userId).gt("createdAt", now - HOUR_MS))
      .take(MAX_PAIRINGS_PER_HOUR);
    if (recent.length >= MAX_PAIRINGS_PER_HOUR) return { status: "rate_limited" as const };
    if ((await activeConnectionCount(ctx, args.userId)) >= MAX_CONNECTIONS_PER_USER) {
      return { status: "too_many_connections" as const };
    }
    const expiresAt = now + PAIRING_TTL_MS;
    const pairingId = await ctx.db.insert("agentPairings", {
      userId: args.userId,
      note: note._id,
      noteId: note.noteId,
      epoch: note.collab.epoch,
      access,
      name,
      siteOrigin: args.siteOrigin,
      codeHash: args.codeHash,
      createdAt: now,
      expiresAt,
      status: "pending",
    });
    return { status: "created" as const, pairingId, expiresAt };
  },
});

export const cancel = mutation({
  args: { pairingId: v.id("agentPairings") },
  handler: async (ctx, { pairingId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const pairing = await ctx.db.get(pairingId);
    if (!pairing || pairing.userId !== userId) return { status: "missing" as const };
    return { status: await cancelPairing(ctx, pairing, Date.now()) };
  },
});

/*
 * waiting: code not used yet; expired / cancelled: it can't be used;
 * accepted: used, but the agent hasn't read the note yet; connected: the
 * agent read the note and still has access to it; access_removed: the code
 * was used, but the connection, its access to the note or the note is gone.
 */
export type PairingState = "waiting" | "expired" | "cancelled" | "accepted" | "connected" | "access_removed";

/* Where a pairing stands, for the owner who created it. */
export const status = query({
  args: { pairingId: v.id("agentPairings") },
  handler: async (ctx, { pairingId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const pairing = await ctx.db.get(pairingId);
    if (!pairing || pairing.userId !== userId) return null;
    const connection = pairing.connectionId ? await ctx.db.get(pairing.connectionId) : null;
    const note = await ctx.db.get(pairing.note);
    const grant = connection
      ? await ctx.db
          .query("agentGrants")
          .withIndex("by_connection_note", (q) => q.eq("connectionId", connection._id).eq("note", pairing.note))
          .first()
      : null;
    const hasAccess = Boolean(connection && !connection.revokedAt && grant && note && !note.deletedAt);
    let state: PairingState;
    if (pairing.status === "pending") state = pairing.expiresAt > Date.now() ? "waiting" : "expired";
    else if (pairing.status === "cancelled") state = "cancelled";
    else if (!hasAccess) state = "access_removed";
    else state = pairing.verifiedAt ? "connected" : "accepted";
    return {
      state,
      noteId: pairing.noteId,
      name: pairing.name,
      // Current access, which the owner may have changed since pairing.
      access: grant?.access ?? pairing.access,
      expiresAt: pairing.expiresAt,
      acceptedAt: pairing.redeemedAt ?? null,
      verifiedAt: pairing.verifiedAt ?? null,
      connectionId: hasAccess && connection ? connection._id : null,
      // The connection has read some note it was given, perhaps not this one.
      connectionVerified: Boolean(hasAccess && connection?.verifiedAt),
      credentialFile: connection?.credentialFile ?? null,
    };
  },
});

/*
 * Use a pairing code. Everything is checked again here, in the transaction
 * that creates the connection: the code is pending and unexpired, its owner
 * still owns the live, connected note with the same epoch, and the owner
 * is under the connection limit. The connection gets exactly the access
 * chosen when the code was made, for this note only.
 */
export const redeem = internalMutation({
  args: { codeHash: v.string(), tokenHash: v.string(), tokenPrefix: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pairing = await ctx.db
      .query("agentPairings")
      .withIndex("by_code_hash", (q) => q.eq("codeHash", args.codeHash))
      .first();
    if (!pairing || pairing.status !== "pending" || pairing.expiresAt <= now) {
      return { ok: false as const, code: "invalid_code" as const };
    }
    const owner = await ctx.db.get(pairing.userId);
    const note = await ctx.db.get(pairing.note);
    if (
      !owner || !note || note.userId !== pairing.userId || note.deletedAt ||
      !note.collab || note.collab.epoch !== pairing.epoch
    ) {
      await ctx.db.patch(pairing._id, { status: "cancelled", cancelledAt: now });
      return { ok: false as const, code: "note_unavailable" as const };
    }
    if ((await activeConnectionCount(ctx, pairing.userId)) >= MAX_CONNECTIONS_PER_USER) {
      return { ok: false as const, code: "too_many_connections" as const };
    }
    const connectionId = await ctx.db.insert("agentConnections", {
      userId: pairing.userId,
      name: pairing.name,
      tokenHash: args.tokenHash,
      tokenPrefix: args.tokenPrefix,
      createdAt: now,
      pairingId: pairing._id,
    });
    const credentialFile = credentialFileName(pairing.siteOrigin, connectionId);
    await ctx.db.patch(connectionId, { credentialFile });
    await ctx.db.insert("agentGrants", {
      userId: pairing.userId,
      connectionId,
      note: note._id,
      noteId: note.noteId,
      access: pairing.access,
      createdAt: now,
    });
    await ctx.db.patch(pairing._id, { status: "redeemed", redeemedAt: now, connectionId });
    return {
      ok: true as const,
      siteOrigin: pairing.siteOrigin,
      noteId: note.noteId,
      credentialFile,
    };
  },
});
