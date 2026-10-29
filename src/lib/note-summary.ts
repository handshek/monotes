/*
 * How a note is named in lists and the browser tab: its first non-empty line,
 * without the Markdown that starts it, then a preview of what follows. Both
 * share one word budget so a row never grows past a glance.
 */

export const UNTITLED_NOTE = "Untitled note";

// Heading, quote, list and task markers at the start of a line.
const LEADING_MARKDOWN = /^\s{0,3}(?:#{1,6}(?=\s|$)|>+|[-*+](?=\s)|\d+[.)](?=\s))\s*(?:\[[ xX]\]\s+)?/;
const CLOSING_HASHES = /\s+#+\s*$/;

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function noteTitleLine(line: string): string {
  return line.replace(LEADING_MARKDOWN, "").replace(CLOSING_HASHES, "").trim();
}

export interface NoteSummary {
  /** The first line as a title, or null for a note with no text. */
  title: string | null;
  /** The words after the title, within the budget, joined by single spaces. */
  preview: string;
}

export function summarizeNote(content: string | undefined | null, maxWords = 20): NoteSummary {
  const lines = (content ?? "").split(/\r?\n/);
  const first = lines.findIndex((line) => noteTitleLine(line).length > 0);
  if (first === -1) return { title: null, preview: "" };

  const titleWords = words(noteTitleLine(lines[first])).slice(0, maxWords);
  const rest = words(lines.slice(first + 1).map(noteTitleLine).join(" ")).slice(0, maxWords - titleWords.length);
  return { title: titleWords.join(" "), preview: rest.join(" ") };
}

export function noteTitle(content: string | undefined | null): string {
  return summarizeNote(content).title ?? UNTITLED_NOTE;
}
