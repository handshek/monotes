"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createNewNote } from "@/lib/local-notes";
import { generateSlug } from "@/lib/ids";

export default function NewNote() {
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    const createAndNavigate = async () => {
      try {
        const slug = generateSlug();
        const note = await createNewNote(slug);
        router.replace(`/${note.id}`);
      } catch {
        setError(true);
      }
    };

    createAndNavigate();
  }, [router]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-page text-text-1">
      <div className="flex flex-col items-center gap-4 text-center">
        {error ? (
          <>
            <p role="alert" className="type-body text-fail-text">Could not create note. Please try again.</p>
            <Link href="/" className="type-body-sm text-text-1 underline underline-offset-4">Back to notes</Link>
          </>
        ) : (
          <>
            <span aria-hidden="true" className="pending" />
            <p className="type-body text-text-2">Creating new note...</p>
          </>
        )}
      </div>
    </main>
  );
}
