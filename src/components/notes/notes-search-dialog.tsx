"use client";

import { useRef, useState, type RefObject } from "react";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { HighlightedText } from "@/components/highlighted-text";
import { useNoteSearch } from "@/hooks/useNoteSearch";

interface NotesSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}

function SearchResults({ onSelect }: { onSelect: (id: string) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const { notes, query, isLoading } = useNoteSearch(searchQuery);

  return (
    <Command shouldFilter={false} label="Search notes" loop>
      <CommandInput
        placeholder="Search notes..."
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      {isLoading ? (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          Loading notes...
        </p>
      ) : notes.length === 0 ? (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          {query ? `No notes matching "${query}".` : "No notes yet."}
        </p>
      ) : null}
      <CommandList
        label={query ? `Search results (${notes.length})` : "Recent notes"}
        aria-busy={searchQuery.trim() !== query}
        className={notes.length === 0 ? "p-0" : undefined}
      >
        {!isLoading && notes.length > 0 && (
          <div className="space-y-2">
            {notes.map((note) => (
              <CommandItem key={note.id} value={note.id} onSelect={onSelect} asChild>
                <Link
                  href={`/${note.id}`}
                  tabIndex={-1}
                  onClickCapture={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                      event.stopPropagation();
                    }
                  }}
                  onClick={(event) => event.preventDefault()}
                  className="border border-border p-3"
                >
                  <span className="line-clamp-3 break-words whitespace-pre-wrap">
                    {note.content.trim() ? (
                      <HighlightedText content={note.content} query={query} contextLines={1} />
                    ) : (
                      "Untitled note"
                    )}
                  </span>
                </Link>
              </CommandItem>
            ))}
          </div>
        )}
      </CommandList>
      <div className="flex shrink-0 items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
        <span>↑ ↓ Navigate</span>
        <span>↵ Open</span>
        <span className="ml-auto">Esc Close</span>
      </div>
    </Command>
  );
}

export default function NotesSearchDialog({
  open,
  onOpenChange,
  onSelect,
  returnFocusRef,
}: NotesSearchDialogProps) {
  const selectedNote = useRef(false);

  const selectNote = (id: string) => {
    selectedNote.current = true;
    onOpenChange(false);
    onSelect(id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[10dvh] flex max-h-[80dvh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        onOpenAutoFocus={() => { selectedNote.current = false; }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = returnFocusRef.current;
          const target = selectedNote.current
            ? document.querySelector<HTMLElement>('.cm-content[contenteditable="true"]')
            : opener?.isConnected ? opener : document.querySelector<HTMLElement>('nav button[aria-label="Toggle sidebar"]');
          target?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search notes</DialogTitle>
        <DialogDescription className="sr-only">
          Search your notes without leaving the current note. Use the arrow keys to choose a note and Enter to open it.
        </DialogDescription>
        <SearchResults onSelect={selectNote} />
      </DialogContent>
    </Dialog>
  );
}
