"use client";

import { useRef, useState, type MouseEvent, type RefObject } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { HighlightedText } from "@/components/highlighted-text";
import { useNoteSearch } from "@/hooks/useNoteSearch";

type SelectNote = (event: MouseEvent<HTMLAnchorElement>, id: string) => void;

interface NotesSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: SelectNote;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

function SearchResults({ onSelect }: { onSelect: SelectNote }) {
  const [searchQuery, setSearchQuery] = useState("");
  const { notes, query, isLoading } = useNoteSearch(searchQuery);

  return (
    <div className="min-h-0 space-y-3 overflow-y-auto px-4 pb-4">
      <Input
        aria-label="Search notes"
        placeholder="Search notes..."
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      <section
        aria-label={query ? `Search results (${notes.length})` : "Recent notes"}
        aria-busy={searchQuery.trim() !== query}
        className="max-h-[40dvh] overflow-y-auto"
      >
        {isLoading ? (
          <p role="status" className="p-3 text-sm text-muted-foreground">
            Loading notes...
          </p>
        ) : notes.length === 0 ? (
          <p role="status" className="p-3 text-sm text-muted-foreground">
            {query ? `No notes matching "${query}".` : "No notes yet."}
          </p>
        ) : (
          <ul className="space-y-1">
            {notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/${note.id}`}
                  onClick={(event) => onSelect(event, note.id)}
                  className="block rounded-sm p-3 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="line-clamp-3 break-words whitespace-pre-wrap">
                    {note.content.trim() ? (
                      <HighlightedText content={note.content} query={query} contextLines={1} />
                    ) : (
                      "Untitled note"
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function NotesSearchDialog({
  open,
  onOpenChange,
  onSelect,
  triggerRef,
}: NotesSearchDialogProps) {
  const selectedNote = useRef(false);

  const selectNote: SelectNote = (event, id) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    selectedNote.current = true;
    onOpenChange(false);
    onSelect(event, id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[10dvh] max-h-[80dvh] translate-y-0 gap-3 overflow-hidden p-0 sm:max-w-xl"
        onOpenAutoFocus={() => { selectedNote.current = false; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = selectedNote.current
            ? document.querySelector<HTMLElement>('.cm-content[contenteditable="true"]')
            : triggerRef.current ?? document.querySelector<HTMLElement>('nav button[aria-label="Toggle sidebar"]');
          target?.focus();
        }}
      >
        <DialogHeader className="px-4 pt-4 pr-12 text-left">
          <DialogTitle>Search notes</DialogTitle>
          <DialogDescription className="sr-only">
            Search your notes without leaving the current note. Select a result to open it.
          </DialogDescription>
        </DialogHeader>
        <SearchResults onSelect={selectNote} />
      </DialogContent>
    </Dialog>
  );
}
