"use client";

import { cn } from "@/lib/sodium/utils";

interface HighlightedTextProps {
  content: string;
  query: string;
  contextLines?: number;
  className?: string;
}

export function HighlightedText({
  content,
  query,
  contextLines = 2,
  className,
}: HighlightedTextProps) {
  if (!query.trim()) {
    return <span className={className}>{content.trim().slice(0, 500)}</span>;
  }

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return <span className={className}>{content.trim().slice(0, 500)}</span>;
  }

  // Find which line the match is on
  const lines = content.split("\n");
  let charCount = 0;
  let matchLineIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= matchIndex) {
      matchLineIndex = i;
      break;
    }
    charCount += lines[i].length + 1; // +1 for newline
  }

  const startLine = Math.max(0, matchLineIndex - contextLines);
  const endLine = Math.min(lines.length - 1, matchLineIndex + contextLines);
  const snippet = lines.slice(startLine, endLine + 1).join("\n");

  // Find match position within snippet
  const snippetLower = snippet.toLowerCase();
  const snippetMatchIndex = snippetLower.indexOf(lowerQuery);

  if (snippetMatchIndex === -1) {
    return <span className={className}>{snippet}</span>;
  }

  const before = snippet.slice(0, snippetMatchIndex);
  const match = snippet.slice(
    snippetMatchIndex,
    snippetMatchIndex + query.length,
  );
  const after = snippet.slice(snippetMatchIndex + query.length);

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {startLine > 0 && "..."}
      {before}
      <mark className="selected">
        {match}
      </mark>
      {after}
      {endLine < lines.length - 1 && "..."}
    </span>
  );
}
