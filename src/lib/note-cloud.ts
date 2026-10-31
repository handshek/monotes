import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { NoteContent } from "@/lib/local-db";

/* The server operations ordinary notes need. */
export interface NoteCloud {
  upload(note: Pick<NoteContent, "id" | "content" | "updatedAt">): Promise<void>;
}

export function convexNoteCloud(client: Pick<ConvexReactClient, "mutation">): NoteCloud {
  return {
    async upload(note) {
      await client.mutation(api.notes.syncNote, {
        noteId: note.id,
        content: note.content,
        updatedAt: note.updatedAt,
      });
    },
  };
}
