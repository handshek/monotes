// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isNoteMeasure,
  noteColumnStyle,
  noteMeasureLabel,
  noteMeasureName,
} from "../../src/lib/note-measure";

describe("note measure", () => {
  it("accepts only the offered widths", () => {
    expect(isNoteMeasure("80")).toBe(true);
    expect(isNoteMeasure("full")).toBe(true);
    expect(isNoteMeasure(80)).toBe(false);
    expect(isNoteMeasure("75")).toBe(false);
    expect(isNoteMeasure(undefined)).toBe(false);
  });

  it("names a width for the control and for screen readers", () => {
    expect(noteMeasureLabel("80")).toBe("80ch");
    expect(noteMeasureLabel("full")).toBe("Full");
    expect(noteMeasureName("120")).toBe("120 characters");
    expect(noteMeasureName("full")).toBe("Full width");
  });

  it("sizes the column in characters of the editor's font, with room for line numbers", () => {
    expect(noteColumnStyle("80", 14, false)).toEqual({ fontSize: "14px", maxWidth: "calc(80ch + 8px)" });
    expect(noteColumnStyle("80", 18, true)).toEqual({ fontSize: "18px", maxWidth: "calc(80ch + 8px + 4ch + 1px)" });
    expect(noteColumnStyle("full", 14, true)).toEqual({ fontSize: "14px" });
  });
});
