"use client";

import { HighlightedText } from "@/components/highlighted-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { generateSlug } from "@/lib/ids";
import { toast } from "sonner";
import { createNewNote } from "@/lib/local-notes";
import { cn } from "@/lib/utils";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSidebar } from "@/components/ui/sidebar";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNoteSearch } from "@/hooks/useNoteSearch";

export default function NotesSearchList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openMobile } = useSidebar();
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchParams.has("search") && !openMobile) {
      searchInput.current?.focus();
    }
  }, [searchParams, openMobile]);

  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const {
    notes: mergedNotes,
    query: debouncedQuery,
    isLoading,
  } = useNoteSearch(searchQuery);

  const getNotePreview = (content: string | undefined) => {
    if (!content?.trim()) return "Untitled note";
    return content.trim().slice(0, 500);
  };

  const getWordCount = (content: string | undefined) => {
    if (!content?.trim()) return 0;
    return content.trim().split(/\s+/).length;
  };

  const onCreateNew = async () => {
    try {
      const slug = generateSlug();
      const note = await createNewNote(slug);
      router.push(`/${note.id}`);
    } catch {
      toast.error("Could not create note. Please try again.");
    }
  };

  const onSearchChange = (value: string) => {
    setSearchQuery(value);
    setShowAll(false);
  };

  const isSearching = debouncedQuery.trim().length > 0;
  const visibleNotes = useMemo(() => {
    if (isSearching) return mergedNotes;
    if (showAll) return mergedNotes;
    return mergedNotes.slice(0, 6);
  }, [isSearching, mergedNotes, showAll]);

  const hasMore = !isSearching && !showAll && mergedNotes.length > 6;

  const isEmpty = !isLoading && mergedNotes.length === 0;
  const sectionTitle = isSearching
    ? `Search results (${mergedNotes.length})`
    : "Your Notes";

  return (
    <>
      <div className="flex gap-3 mb-8" role="search">
        <Input
          ref={searchInput}
          id="notes-search"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1"
          aria-label="Search notes"
        />
        <Button
          onClick={onCreateNew}
          size="default"
          aria-label="Create new note"
        >
          <PlusIcon className="size-4 mr-2" />
          New Note
        </Button>
      </div>
      <section className="mb-16" aria-label={sectionTitle}>
        <h2 className="text-2xl font-semibold mb-4">{sectionTitle}</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="mb-4">
              {isSearching
                ? `No notes matching "${debouncedQuery}".`
                : "No notes yet."}
            </p>
            {!isSearching && (
              <Button onClick={onCreateNew} variant="outline">
                <PlusIcon className="size-4 mr-2" />
                Create your first note
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/${note.id}`}
                  className={cn(
                    "group flex flex-col justify-between border bg-card hover:bg-accent p-4 h-[180px]",
                    "hover:border-ring",
                  )}
                >
                  <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]">
                    <h3 className="font-medium text-sm whitespace-pre-wrap break-words">
                      {isSearching ? (
                        <HighlightedText
                          content={note.content}
                          query={debouncedQuery}
                        />
                      ) : (
                        getNotePreview(note.content)
                      )}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between pt-4">
                    {note.updatedAt && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(note.updatedAt).toLocaleDateString()}
                        <span className="mx-2">•</span>
                        {getWordCount(note.content)} words
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center mt-6">
                <Button variant="outline" onClick={() => setShowAll(true)}>
                  Show all ({mergedNotes.length} notes)
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
