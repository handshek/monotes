import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { removeGrantsForNote } from "./lib/history";

// Connected notes accept changes only through versioned collaboration
// updates. A whole-note write, for example from an older open tab, must
// never replace that history. The client recognises this message.
export const COLLABORATIVE_NOTE_ERROR = "note_is_collaborative";

/*
 * Sync a local note to the cloud
 * Creates a new note document in the cloud
 */
export const syncNote = mutation({
  args: {
    noteId: v.string(),
    content: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    // Check if note already exists
    const existing = await ctx.db
      .query("notes")
      .withIndex("by_user_and_noteId", (q) =>
        q.eq("userId", userId).eq("noteId", args.noteId)
      )
      .first();

    if (existing?.collab) {
      throw new Error(COLLABORATIVE_NOTE_ERROR);
    }

    if (existing) {
      return await ctx.db.patch(existing._id, {
        content: args.content,
        updatedAt: args.updatedAt,
        deletedAt: undefined, // Clear soft delete if exists
      });
    }

    // Create new note
    return await ctx.db.insert("notes", {
      userId,
      noteId: args.noteId,
      content: args.content,
      updatedAt: args.updatedAt,
    });
  },
});

/*
 * Get a single note by noteId
 */
export const getNote = query({
  args: {
    noteId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const note = await ctx.db
      .query("notes")
      .withIndex("by_user_and_noteId", (q) =>
        q.eq("userId", userId).eq("noteId", args.noteId)
      )
      .first();

    if (!note || note.deletedAt) {
      return null;
    }

    return note;
  },
});

/*
 * List all user's notes (excluding soft-deleted)
 */
export const listUserNotes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Filter out soft-deleted notes and sort by updatedAt descending
    return notes
      .filter((notes) => !notes.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/*
 * Search user's notes by content (case-insensitive)
 */
export const searchNotes = query({
  args: {
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const notes = await ctx.db
      .query("notes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const query = args.searchQuery.toLowerCase();

    return notes
      .filter((note) => !note.deletedAt)
      .filter((note) => note.content.toLowerCase().includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/*
 * Update an existing note's content
 */

export const updateNote = mutation({
  args: {
    noteId: v.string(),
    content: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    const note = await ctx.db
      .query("notes")
      .withIndex("by_user_and_noteId", (q) =>
        q.eq("userId", userId).eq("noteId", args.noteId)
      )
      .first();

    if (!note) {
      throw new Error("Note not found");
    }

    if (note.collab) {
      throw new Error(COLLABORATIVE_NOTE_ERROR);
    }

    return await ctx.db.patch(note._id, {
      content: args.content,
      updatedAt: args.updatedAt,
    });
  },
});

/*
 * Soft delete a note (sets deletedAt timestamp)
 */
export const deleteNote = mutation({
  args: {
    noteId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    const note = await ctx.db
      .query("notes")
      .withIndex("by_user_and_noteId", (q) =>
        q.eq("userId", userId).eq("noteId", args.noteId)
      )
      .first();

    if (!note) {
      throw new Error("Note not found");
    }

    await removeGrantsForNote(ctx, note._id);
    return await ctx.db.patch(note._id, {
      deletedAt: note.deletedAt ?? Date.now(),
    });
  },
});
