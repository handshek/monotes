"use client";

import { HighlightedText } from "@/components/highlighted-text";
import { Button } from "@/components/sodium/ui/button";
import { Input } from "@/components/sodium/ui/input";
import { SkeletonRows } from "@/components/sodium/ui/skeleton";
import {
  Frame,
  FrameFooter,
  FrameHeader,
  FrameTitle,
  FrameValue,
} from "@/components/sodium/ui/frame";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyIcon,
  EmptyTitle,
} from "@/components/sodium/ui/empty-state";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMeta,
  ItemTitle,
} from "@/components/sodium/ui/item";
import { Icon, Add, Document, Search } from "@/components/sodium/icon";
import { toast } from "@/components/sodium/ui/toast";
import { generateSlug } from "@/lib/ids";
import { createNewNote } from "@/lib/local-notes";
import { summarizeNote, UNTITLED_NOTE } from "@/lib/note-summary";
import { formatExactTime, formatRelativeTime } from "@/lib/relative-time";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSidebar } from "@/components/sidebar";
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
      toast.fail("Could not create note. Please try again.");
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
      <div className="flex gap-2" role="search">
        <Input
          ref={searchInput}
          id="notes-search"
          placeholder="Search notes..."
          value={searchQuery}
          onValueChange={onSearchChange}
          leading={<Icon icon={Search} />}
          className="min-w-0 flex-1"
          aria-label="Search notes"
        />
        <Button onClick={onCreateNew} aria-label="Create new note">
          <Icon icon={Add} />
          New Note
        </Button>
      </div>
      <Frame aria-label={sectionTitle}>
        <FrameHeader>
          <FrameTitle>{sectionTitle}</FrameTitle>
          {!isSearching && mergedNotes.length > 0 && (
            <FrameValue meta>
              {mergedNotes.length} {mergedNotes.length === 1 ? "note" : "notes"}
            </FrameValue>
          )}
        </FrameHeader>
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : isEmpty ? (
          <Empty reason={isSearching ? "no-results" : "empty"} variant="plain">
            <EmptyIcon icon={isSearching ? Search : Document} />
            <EmptyHeader>
              <EmptyTitle>
                {isSearching
                  ? `No notes matching "${debouncedQuery}".`
                  : "No notes yet."}
              </EmptyTitle>
            </EmptyHeader>
            {!isSearching && (
              <EmptyContent>
                <Button onClick={onCreateNew} variant="secondary">
                  <Icon icon={Add} />
                  Create your first note
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <>
            <ItemGroup variant="plain">
              {visibleNotes.map((note) => {
                const { title, preview } = summarizeNote(note.content, 40);
                return (
                  <Item key={note.id} className="items-start py-3">
                    <ItemContent>
                      {/* A title the person wrote wraps rather than ending in an ellipsis. */}
                      <ItemTitle className="items-start [&>*:first-child]:whitespace-normal">
                        <Link
                          href={`/${note.id}`}
                          data-slot="item-link"
                          data-control=""
                          className={
                            isSearching
                              ? "line-clamp-3 break-words whitespace-pre-wrap after:absolute after:inset-0 after:content-['']"
                              : "min-w-0 break-words after:absolute after:inset-0 after:content-['']"
                          }
                        >
                          {isSearching ? (
                            <HighlightedText
                              content={note.content}
                              query={debouncedQuery}
                            />
                          ) : (
                            (title ?? UNTITLED_NOTE)
                          )}
                        </Link>
                      </ItemTitle>
                      {!isSearching && preview && (
                        <ItemDescription className="line-clamp-1">{preview}</ItemDescription>
                      )}
                    </ItemContent>
                    {note.updatedAt && (
                      <ItemMeta>
                        <time
                          dateTime={new Date(note.updatedAt).toISOString()}
                          title={formatExactTime(note.updatedAt)}
                        >
                          {formatRelativeTime(note.updatedAt)}
                        </time>
                        {" · "}
                        {getWordCount(note.content)} words
                      </ItemMeta>
                    )}
                  </Item>
                );
              })}
            </ItemGroup>
            {hasMore && (
              <FrameFooter className="justify-start">
                <Button variant="secondary" size="sm" onClick={() => setShowAll(true)}>
                  Show all ({mergedNotes.length} notes)
                </Button>
              </FrameFooter>
            )}
          </>
        )}
      </Frame>
    </>
  );
}
