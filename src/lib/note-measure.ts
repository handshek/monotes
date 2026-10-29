import type { CSSProperties } from "react";

/*
 * How wide a note's column runs, as a measure in characters. Notes are set in
 * Commit Mono, where 1ch is exactly one character, so "80" means 80 characters
 * of text per line at the editor's font size. "full" fills the space beside the
 * sidebar.
 */

export const NOTE_MEASURES = ["60", "80", "100", "120", "full"] as const;
export type NoteMeasure = (typeof NOTE_MEASURES)[number];

export const DEFAULT_NOTE_MEASURE: NoteMeasure = "100";

export function isNoteMeasure(value: unknown): value is NoteMeasure {
  return typeof value === "string" && (NOTE_MEASURES as readonly string[]).includes(value);
}

/** "80ch" or "Full", as the control shows it. */
export function noteMeasureLabel(measure: NoteMeasure): string {
  return measure === "full" ? "Full" : `${measure}ch`;
}

/** "80 characters" or "Full width", for screen readers and settings. */
export function noteMeasureName(measure: NoteMeasure): string {
  return measure === "full" ? "Full width" : `${measure} characters`;
}

// CodeMirror pads each line by 6px before the text and 2px after it.
const LINE_PADDING = "8px";
// With line numbers on, the gutter takes about four characters plus its rule.
const GUTTER = "4ch + 1px";

/**
 * The note column's width. It takes the editor's font size so that 1ch in its
 * max-width is one character of the note's text.
 */
export function noteColumnStyle(
  measure: NoteMeasure,
  fontSize: number,
  lineNumbers: boolean,
): CSSProperties {
  if (measure === "full") return { fontSize: `${fontSize}px` };
  const extra = lineNumbers ? `${LINE_PADDING} + ${GUTTER}` : LINE_PADDING;
  return { fontSize: `${fontSize}px`, maxWidth: `calc(${measure}ch + ${extra})` };
}
