"use client";

import Navbar from "@/app/(notes)/navbar";
import NoteView from "@/components/notes/note-view";
import { useParams } from "next/navigation";
import { isValidSlug } from "@/lib/ids";

export default function Note() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  // invalid slug format
  if (id && !isValidSlug(id)) {
    return (
      <div className="bg-background p-2">
        <Navbar />
        <main className="flex">
          <section className="flex-1 md:max-w-4xl mx-auto">
            <div className="py-12 text-center text-muted-foreground">
              Invalid note ID. Create a new note from the + button.
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-background p-2">
      <Navbar />
      <main className="flex">
        <section className="flex-1 md:max-w-4xl mx-auto">
          {id && <NoteView key={id} noteId={id} />}
        </section>
      </main>
    </div>
  );
}
