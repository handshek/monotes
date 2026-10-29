// @vitest-environment node
import { describe, expect, it } from "vitest";
import { noteTitle, summarizeNote, UNTITLED_NOTE } from "../../src/lib/note-summary";
import { formatRelativeTime } from "../../src/lib/relative-time";

describe("summarizeNote", () => {
  it("names a note by its first line without the Markdown that starts it", () => {
    expect(summarizeNote("# Groceries\n\nOat milk, lemons and **coffee**.")).toEqual({
      title: "Groceries",
      preview: "Oat milk, lemons and **coffee**.",
    });
    expect(noteTitle("  ## Release plan ##\n- ship")).toBe("Release plan");
    expect(noteTitle("> A quote")).toBe("A quote");
    expect(noteTitle("- [ ] Buy bread")).toBe("Buy bread");
    expect(noteTitle("1. First step")).toBe("First step");
  });

  it("drops list and quote markers from the preview", () => {
    expect(summarizeNote("## Release plan\n- Parser unit tests\n- [x] Ship on Friday\n> Not before")).toEqual({
      title: "Release plan",
      preview: "Parser unit tests Ship on Friday Not before",
    });
  });

  it("keeps text that only looks like Markdown", () => {
    expect(noteTitle("#hashtag notes")).toBe("#hashtag notes");
    expect(noteTitle("-5 degrees")).toBe("-5 degrees");
  });

  it("skips blank and marker-only lines to find the title", () => {
    expect(summarizeNote("\n#\n  \nActual title\nmore")).toEqual({ title: "Actual title", preview: "more" });
  });

  it("shares one word budget between the title and the preview", () => {
    const words = Array.from({ length: 24 }, (_, index) => `word${index + 1}`);
    const summary = summarizeNote(`  ${words[0]} ${words[1]}\n${words.slice(2).join("\t")}`);
    expect(summary.title).toBe("word1 word2");
    expect(`${summary.title} ${summary.preview}`).toBe(words.slice(0, 20).join(" "));
  });

  it("has no title for a note without text", () => {
    expect(summarizeNote(" \t\n  ")).toEqual({ title: null, preview: "" });
    expect(noteTitle(undefined)).toBe(UNTITLED_NOTE);
  });
});

describe("formatRelativeTime", () => {
  const now = new Date(2026, 9, 29, 15, 0).getTime();
  it("reads recent edits relative to now", () => {
    expect(formatRelativeTime(now - 20_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe("3 min ago");
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(formatRelativeTime(new Date(2026, 9, 28, 22, 0).getTime(), now)).toBe("yesterday");
  });

  it("falls back to a date, with the year only when it differs", () => {
    expect(formatRelativeTime(new Date(2026, 8, 3).getTime(), now)).toBe("Sep 3");
    expect(formatRelativeTime(new Date(2025, 11, 31).getTime(), now)).toBe("Dec 31, 2025");
  });
});
