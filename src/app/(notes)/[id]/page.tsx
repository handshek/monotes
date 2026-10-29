"use client";

import Navbar from "@/app/(notes)/navbar";
import NoteView from "@/components/notes/note-view";
import { useParams } from "next/navigation";
import { isValidSlug } from "@/lib/ids";
import { useEditorSettings } from "@/contexts/editor-settings-context";
import { noteColumnStyle } from "@/lib/note-measure";

export default function Note() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { settings } = useEditorSettings();

  // invalid slug format
  if (id && !isValidSlug(id)) {
    return (
      <div className="min-h-dvh bg-page p-2 text-text-1">
        <Navbar />
        <main className="flex">
          <section className="mx-auto flex-1 md:max-w-224">
            <p className="py-12 text-center type-body text-text-2">
              Invalid note ID. Create a new note from the + button.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-page p-2 text-text-1">
      <Navbar />
      <main className="flex">
        {/* The note's width: the setting's measure, in characters of the editor's font. */}
        <section
          className="mx-auto min-w-0 flex-1"
          style={noteColumnStyle(settings.measure, settings.fontSize, settings.lineNumbers)}
        >
          {id && <NoteView key={id} noteId={id} />}
        </section>
      </main>
    </div>
  );
}
