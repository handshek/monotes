/*
 * Imported tweakcn themes describe a shadcn palette (--background, --primary, ...).
 * Sodium reads its own roles (--page, --primary-bg, --line, ...), so a theme is
 * translated into those roles and set on the .sodium element. Roles a theme has
 * no colour for are derived from the ones it has; anything it cannot supply keeps
 * Sodium's value. Radius, shadows and fonts are never taken from a theme.
 */

type ThemeVars = Record<string, string>;

const mix = (a: string, pct: number, b: string) =>
  `color-mix(in oklab, ${a} ${pct}%, ${b})`;

function isColor(value: string | undefined): value is string {
  if (!value) return false;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return value.trim().length > 0;
  }
  return CSS.supports("color", value);
}

/** Reads a theme value by name, with or without the leading "--". */
function pick(vars: ThemeVars, name: string): string | undefined {
  const value = vars[`--${name}`] ?? vars[name];
  return isColor(value) ? value : undefined;
}

/**
 * Maps a shadcn/tweakcn palette onto Sodium's colour roles. Returns only the
 * roles it can fill; the caller sets them as inline custom properties.
 */
export function sodiumVarsFromTheme(vars: ThemeVars): Record<string, string> {
  const bg = pick(vars, "background");
  const fg = pick(vars, "foreground");
  const primary = pick(vars, "primary");
  if (!bg || !fg || !primary) return {};

  const primaryFg = pick(vars, "primary-foreground") ?? bg;
  const card = pick(vars, "card") ?? bg;
  const muted = pick(vars, "muted") ?? mix(fg, 5, bg);
  const mutedFg = pick(vars, "muted-foreground") ?? mix(fg, 60, bg);
  const secondary = pick(vars, "secondary") ?? muted;
  const border = pick(vars, "border") ?? mix(fg, 12, bg);
  const input = pick(vars, "input") ?? border;
  const destructive = pick(vars, "destructive");

  // Text and marks in the primary hue, pulled toward the ink so they stay legible.
  const primaryInk = mix(primary, 65, fg);
  const secondaryBg = mix(secondary, 60, bg);
  const edgeHover = mix(border, 88, fg);

  const out: Record<string, string> = {
    "--page": bg,
    "--panel": card === bg ? mix(bg, 97, fg) : card,
    "--well": muted,
    "--hover": mix(fg, 4, "transparent"),
    "--pressed": mix(fg, 8, "transparent"),
    "--selected": mix(primary, 22, bg),
    "--selected-strong": mix(primary, 35, bg),

    "--text-1": fg,
    "--text-2": mix(fg, 45, mutedFg),
    "--text-3": mutedFg,
    "--text-disabled": mix(mutedFg, 55, bg),
    "--text-inverse": bg,

    "--line-faint": mix(border, 60, bg),
    "--line": border,
    "--line-control": mix(fg, 45, bg),
    "--mark": mix(fg, 45, bg),
    "--dot": border,

    "--accent": primary,
    "--accent-text": primaryInk,
    "--accent-edge": mix(primary, 80, fg),

    "--primary-bg": primary,
    "--primary-text": primaryFg,
    "--primary-edge": mix(primary, 80, fg),
    "--primary-hover": mix(primary, 88, primaryFg),
    "--primary-edge-hover": mix(primary, 85, fg),
    "--primary-pressed": mix(primary, 92, fg),
    "--primary-light": mix(primaryFg, 35, "transparent"),
    "--primary-light-hover": mix(primaryFg, 60, "transparent"),
    "--primary-ring": mix(primary, 15, bg),

    "--secondary-bg": secondaryBg,
    "--secondary-hover": bg,
    "--secondary-pressed": secondary,
    "--secondary-edge": border,
    "--secondary-edge-hover": edgeHover,
    "--secondary-ring": mix(fg, 4, "transparent"),

    "--check-bg": primary,
    "--check-edge": mix(primary, 80, fg),
    "--check-mark": primaryFg,
    "--check-off": secondaryBg,
    "--check-off-hover": bg,
    "--check-range": primaryInk,

    "--field-bg": secondaryBg,
    "--field-hover": bg,
    "--field-edge": input,
    "--field-edge-hover": edgeHover,
    "--field-ring-hover": mix(fg, 4, "transparent"),
    "--field-focus-bg": bg,
    "--field-focus-edge": primaryInk,
    "--field-ring-focus": mix(primary, 25, "transparent"),
    "--row-highlight": mix(bg, 97, fg),
    "--row-highlight-edge": border,

    "--data-1": primary,
    "--focus": primaryInk,
    "--caret": primaryInk,
    "--scrollbar-thumb": mix(fg, 24, "transparent"),
  };

  if (destructive) {
    out["--fail"] = destructive;
    out["--fail-text"] = mix(destructive, 80, fg);
    out["--fail-tint"] = mix(destructive, 12, bg);
    out["--field-ring-fail"] = mix(destructive, 20, "transparent");
  }

  return out;
}

export function applySodiumVars(el: HTMLElement, vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) el.style.setProperty(key, value);
}

export function clearSodiumVars(el: HTMLElement, vars: Record<string, string>) {
  for (const key of Object.keys(vars)) el.style.removeProperty(key);
}
