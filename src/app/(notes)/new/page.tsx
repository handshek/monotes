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
    <main className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        {error ? (
          <>
            <p role="alert" className="text-destructive mb-4">Could not create note. Please try again.</p>
            <Link href="/" className="underline">Back to notes</Link>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Creating new note...</p>
          </>
        )}
      </div>
    </main>
  );
}
