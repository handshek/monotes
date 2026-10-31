import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const stepAuthor = v.union(
  v.object({ kind: v.literal("user") }),
  v.object({ kind: v.literal("agent"), connectionId: v.id("agentConnections") }),
  v.object({ kind: v.literal("restore") }),
);

export const checkpointReason = v.union(
  v.literal("enabled"),
  v.literal("periodic"),
  v.literal("before_agent_edit"),
  v.literal("before_restore"),
  v.literal("unchosen_copy"),
  v.literal("late_overlap_draft"),
);

export const grantAccess = v.union(v.literal("read"), v.literal("edit"));

const schema = defineSchema({
  ...authTables,
  users: defineTable({
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    name: v.optional(v.string()),
  }).index("email", ["email"]),
  notes: defineTable({
    userId: v.id("users"),
    noteId: v.string(),
    content: v.string(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    // Bumped by every whole-note write, so a device that hasn't seen the
    // latest text can't overwrite it. Absent means 0.
    revision: v.optional(v.number()),
    // Present once a note is explicitly connected for live agent editing.
    // From then on only the versioned collaboration path may change it.
    collab: v.optional(
      v.object({
        epoch: v.string(),
        version: v.number(),
        enabledAt: v.number(),
      }),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_noteId", ["userId", "noteId"]),
  // Accepted updates; each batch covers versions fromVersion+1..toVersion.
  noteSteps: defineTable({
    note: v.id("notes"),
    fromVersion: v.number(),
    toVersion: v.number(),
    clientId: v.string(),
    author: stepAuthor,
    updates: v.array(v.object({ seq: v.number(), changes: v.string() })),
    createdAt: v.number(),
  }).index("by_note_to", ["note", "toVersion"]),
  // "base" checkpoints hold the exact text at `version`. "aside" checkpoints
  // preserve alternative text (an unchosen copy or a pre-merge draft).
  noteCheckpoints: defineTable({
    note: v.id("notes"),
    version: v.number(),
    body: v.id("noteCheckpointBodies"),
    textLength: v.number(),
    kind: v.union(v.literal("base"), v.literal("aside")),
    reason: checkpointReason,
    connectionId: v.optional(v.id("agentConnections")),
    createdAt: v.number(),
  })
    .index("by_note_kind_version", ["note", "kind", "version"])
    .index("by_note", ["note"]),
  // Checkpoint text lives apart from its metadata so listing checkpoints
  // never reads every stored copy of the note.
  noteCheckpointBodies: defineTable({ text: v.string() }),
  collabClients: defineTable({
    note: v.id("notes"),
    clientId: v.string(),
    lastSeq: v.number(),
  }).index("by_note_client", ["note", "clientId"]),
  agentConnections: defineTable({
    userId: v.id("users"),
    name: v.string(),
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    // Set for connections made with a pairing code, with the (non-secret)
    // name of the private access file the agent saved.
    pairingId: v.optional(v.id("agentPairings")),
    credentialFile: v.optional(v.string()),
    // First time the connection read a note it was granted: proof it works.
    verifiedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user", ["userId"])
    // Active connections have no revokedAt, so they can be counted directly.
    .index("by_user_revoked", ["userId", "revokedAt"]),
  agentGrants: defineTable({
    userId: v.id("users"),
    connectionId: v.id("agentConnections"),
    note: v.id("notes"),
    // The note's public id, so lists of grants never read note text.
    noteId: v.string(),
    access: grantAccess,
    createdAt: v.number(),
    firstReadAt: v.optional(v.number()),
  })
    .index("by_connection", ["connectionId"])
    .index("by_note", ["note"])
    .index("by_connection_note", ["connectionId", "note"]),
  // One-time pairing codes. A code (only its hash is stored) lets an agent
  // create its own connection with exactly the access chosen here, for this
  // note only, within ten minutes, once.
  agentPairings: defineTable({
    userId: v.id("users"),
    note: v.id("notes"),
    noteId: v.string(),
    epoch: v.string(),
    access: grantAccess,
    name: v.string(),
    // The Monotes address the agent should use, saved into its access file.
    siteOrigin: v.string(),
    codeHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("redeemed"), v.literal("cancelled")),
    redeemedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    connectionId: v.optional(v.id("agentConnections")),
    verifiedAt: v.optional(v.number()),
  })
    .index("by_code_hash", ["codeHash"])
    .index("by_user_status_expires", ["userId", "status", "expiresAt"])
    .index("by_user_created", ["userId", "createdAt"]),
  // Compact receipts of agent edit requests, for retries with the same
  // requestId. Successful receipts never hold note text.
  agentRequests: defineTable({
    connectionId: v.id("agentConnections"),
    requestId: v.string(),
    payloadHash: v.string(),
    status: v.number(),
    body: v.string(),
    createdAt: v.number(),
  })
    .index("by_connection_request", ["connectionId", "requestId"])
    .index("by_connection_created", ["connectionId", "createdAt"]),
  noteActivity: defineTable({
    note: v.id("notes"),
    kind: v.union(
      v.literal("enabled"),
      v.literal("agent_edit"),
      v.literal("restore"),
      v.literal("late_overlap"),
    ),
    connectionId: v.optional(v.id("agentConnections")),
    fromVersion: v.number(),
    toVersion: v.number(),
    checkpointId: v.optional(v.id("noteCheckpoints")),
    createdAt: v.number(),
  }).index("by_note", ["note"]),
  agentRateWindows: defineTable({
    connectionId: v.id("agentConnections"),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_connection", ["connectionId"]),
});

export default schema;
