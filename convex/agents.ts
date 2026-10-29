/*
 * Owner-side management of agent connections and per-note grants. These
 * functions require the signed-in owner's session; agent keys cannot call
 * them, so an agent can never grant itself access.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  MAX_CONNECTIONS_PER_USER,
  cleanConnectionName,
  generateToken,
  sha256Hex,
  tokenLabel,
} from "./lib/agentAuth";
import { findOwnedNote, isCollabNote } from "./lib/history";

const GRANTS_SHOWN = 100;

/*
 * What the owner can honestly say about a connection:
 * - connected: it has read a note it was given;
 * - waiting: it was made with a pairing code but hasn't read anything yet;
 * - used: a manual key that made requests before reads were recorded;
 * - unused: a manual key that has never been used.
 */
function connectionState(connection: Doc<"agentConnections">) {
  if (connection.verifiedAt) return "connected" as const;
  if (connection.pairingId) return "waiting" as const;
  return connection.lastUsedAt ? ("used" as const) : ("unused" as const);
}

function describeConnection(connection: Doc<"agentConnections">) {
  return {
    id: connection._id,
    name: connection.name,
    keyLabel: connection.tokenPrefix,
    createdAt: connection.createdAt,
    lastUsedAt: connection.lastUsedAt ?? null,
    state: connectionState(connection),
    kind: connection.pairingId ? ("paired" as const) : ("manual" as const),
    credentialFile: connection.credentialFile ?? null,
  };
}

async function ownedConnection(ctx: QueryCtx, userId: Id<"users">, connectionId: Id<"agentConnections">) {
  const connection = await ctx.db.get(connectionId);
  if (!connection || connection.userId !== userId || connection.revokedAt) return null;
  return connection;
}

async function activeConnections(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db
    .query("agentConnections")
    .withIndex("by_user_revoked", (q) => q.eq("userId", userId).eq("revokedAt", undefined))
    .take(MAX_CONNECTIONS_PER_USER);
}

export const createConnection = action({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<
    | { status: "created"; connectionId: Id<"agentConnections">; name: string; token: string }
    | { status: "signed_out" | "invalid_name" | "too_many" }
  > => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" };
    const cleaned = cleanConnectionName(name);
    if (!cleaned) return { status: "invalid_name" };
    const token = generateToken();
    const result: { status: "created"; connectionId: Id<"agentConnections"> } | { status: "too_many" } =
      await ctx.runMutation(internal.agents.insertConnection, {
        userId,
        name: cleaned,
        tokenHash: await sha256Hex(token),
        tokenPrefix: tokenLabel(token),
      });
    if (result.status !== "created") return result;
    // The key is returned once and never stored in readable form.
    return { status: "created", connectionId: result.connectionId, name: cleaned, token };
  },
});

export const insertConnection = internalMutation({
  args: { userId: v.id("users"), name: v.string(), tokenHash: v.string(), tokenPrefix: v.string() },
  handler: async (ctx, args) => {
    if ((await activeConnections(ctx, args.userId)).length >= MAX_CONNECTIONS_PER_USER) {
      return { status: "too_many" as const };
    }
    const connectionId = await ctx.db.insert("agentConnections", { ...args, createdAt: Date.now() });
    return { status: "created" as const, connectionId };
  },
});

export const listConnections = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const connections = await activeConnections(ctx, userId);
    return Promise.all(
      connections.map(async (connection) => {
        // Grants are small and removed when their note is deleted, so no
        // note text is read here; titles come from the browser's own copy.
        const grants = await ctx.db
          .query("agentGrants")
          .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
          .take(GRANTS_SHOWN + 1);
        const notes = grants.slice(0, GRANTS_SHOWN).map((grant) => ({ noteId: grant.noteId, access: grant.access }));
        return { ...describeConnection(connection), notes, moreNotes: grants.length > GRANTS_SHOWN };
      }),
    );
  },
});

export const renameConnection = mutation({
  args: { connectionId: v.id("agentConnections"), name: v.string() },
  handler: async (ctx, { connectionId, name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const connection = await ownedConnection(ctx, userId, connectionId);
    if (!connection) return { status: "missing" as const };
    const cleaned = cleanConnectionName(name);
    if (!cleaned) return { status: "invalid_name" as const };
    await ctx.db.patch(connectionId, { name: cleaned });
    return { status: "ok" as const };
  },
});

async function deleteGrants(ctx: MutationCtx, connectionId: Id<"agentConnections">) {
  const grants = await ctx.db
    .query("agentGrants")
    .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
    .collect();
  for (const grant of grants) await ctx.db.delete(grant._id);
}

/* Revoking takes effect for every later request; the key cannot be revived. */
export const revokeConnection = mutation({
  args: { connectionId: v.id("agentConnections") },
  handler: async (ctx, { connectionId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const connection = await ownedConnection(ctx, userId, connectionId);
    if (!connection) return { status: "missing" as const };
    await ctx.db.patch(connectionId, { revokedAt: Date.now() });
    await deleteGrants(ctx, connectionId);
    return { status: "ok" as const };
  },
});

export const noteGrants = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const note = await findOwnedNote(ctx, userId, noteId);
    const connections = await activeConnections(ctx, userId);
    const grants = isCollabNote(note) && !note.deletedAt
      ? await ctx.db.query("agentGrants").withIndex("by_note", (q) => q.eq("note", note._id)).collect()
      : [];
    return connections.map((connection) => {
      const grant = grants.find((candidate) => candidate.connectionId === connection._id);
      return {
        ...describeConnection(connection),
        access: grant?.access ?? ("none" as const),
        readThisNoteAt: grant?.firstReadAt ?? null,
      };
    });
  },
});

export const setGrant = mutation({
  args: {
    noteId: v.string(),
    connectionId: v.id("agentConnections"),
    access: v.union(v.literal("none"), v.literal("read"), v.literal("edit")),
  },
  handler: async (ctx, { noteId, connectionId, access }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { status: "signed_out" as const };
    const connection = await ownedConnection(ctx, userId, connectionId);
    if (!connection) return { status: "missing" as const };
    const note = await findOwnedNote(ctx, userId, noteId);
    if (!isCollabNote(note) || note.deletedAt) return { status: "not_connected" as const };
    const existing = await ctx.db
      .query("agentGrants")
      .withIndex("by_connection_note", (q) => q.eq("connectionId", connectionId).eq("note", note._id))
      .first();
    if (access === "none") {
      if (existing) await ctx.db.delete(existing._id);
    } else if (existing) {
      await ctx.db.patch(existing._id, { access });
    } else {
      await ctx.db.insert("agentGrants", {
        userId,
        connectionId,
        note: note._id,
        noteId: note.noteId,
        access,
        createdAt: Date.now(),
      });
    }
    return { status: "ok" as const };
  },
});
