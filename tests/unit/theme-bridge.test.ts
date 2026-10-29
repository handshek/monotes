// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { sodiumVarsFromTheme } from "../../src/lib/theme-bridge";

const tangerineLight = {
  "--background": "oklch(0.9383 0.0042 236.4993)",
  "--foreground": "oklch(0.3211 0 0)",
  "--card": "oklch(1.0000 0 0)",
  "--primary": "oklch(0.6397 0.1720 36.4421)",
  "--primary-foreground": "oklch(1.0000 0 0)",
  "--muted": "oklch(0.9670 0.0029 264.5419)",
  "--muted-foreground": "oklch(0.5510 0.0234 264.3637)",
  "--border": "oklch(0.9022 0.0052 247.8822)",
  "--destructive": "oklch(0.6368 0.2078 25.3313)",
  "--radius": "0.75rem",
  "--shadow-md": "0px 6px 12px -3px hsl(0 0% 0% / 0.09)",
  "--font-sans": "Inter, sans-serif",
};

afterEach(() => vi.unstubAllGlobals());

describe("sodiumVarsFromTheme", () => {
  it("maps a tweakcn palette onto Sodium's roles", () => {
    const vars = sodiumVarsFromTheme(tangerineLight);
    expect(vars["--page"]).toBe(tangerineLight["--background"]);
    expect(vars["--text-1"]).toBe(tangerineLight["--foreground"]);
    expect(vars["--primary-bg"]).toBe(tangerineLight["--primary"]);
    expect(vars["--primary-text"]).toBe(tangerineLight["--primary-foreground"]);
    expect(vars["--line"]).toBe(tangerineLight["--border"]);
    expect(vars["--panel"]).toBe(tangerineLight["--card"]);
    expect(vars["--fail"]).toBe(tangerineLight["--destructive"]);
    // Focus and accent text are pulled toward the ink so they stay legible.
    expect(vars["--focus"]).toContain(tangerineLight["--foreground"]);
    expect(vars["--accent-text"]).toBe(vars["--focus"]);
  });

  it("never takes radius, shadows or fonts from a theme", () => {
    const vars = sodiumVarsFromTheme(tangerineLight);
    expect(Object.keys(vars).some((key) => /radius|shadow|font/.test(key))).toBe(false);
  });

  it("accepts the unprefixed names tweakcn uses for its dark palette", () => {
    const vars = sodiumVarsFromTheme({
      background: "#141412",
      foreground: "#f5f3ee",
      primary: "#ff7a1a",
    });
    expect(vars["--page"]).toBe("#141412");
    expect(vars["--primary-bg"]).toBe("#ff7a1a");
    // Without a destructive colour Sodium keeps its own failure roles.
    expect(vars["--fail"]).toBeUndefined();
  });

  it("keeps Sodium's palette when a theme lacks the core colours", () => {
    expect(sodiumVarsFromTheme({ "--background": "#fff", "--foreground": "#000" })).toEqual({});
  });

  it("skips values the browser does not accept as colours", () => {
    vi.stubGlobal("CSS", { supports: (_prop: string, value: string) => !value.startsWith("0 0%") });
    const vars = sodiumVarsFromTheme({ ...tangerineLight, "--border": "0 0% 90%" });
    expect(vars["--page"]).toBe(tangerineLight["--background"]);
    // The border falls back to a colour derived from the ink and the page.
    expect(vars["--line"]).toContain("color-mix");
  });
});
