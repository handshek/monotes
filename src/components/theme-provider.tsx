"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { ThemePreset } from "@/lib/themes";
import {
  applySodiumVars,
  clearSodiumVars,
  sodiumVarsFromTheme,
} from "@/lib/theme-bridge";

interface ColorThemeContextType {
  activeTheme: ThemePreset | null;
  setActiveTheme: (theme: ThemePreset | null) => void;
  isLoading: boolean;
}

const ColorThemeContext = React.createContext<ColorThemeContextType>({
  activeTheme: null,
  setActiveTheme: () => {},
  isLoading: false,
});

export const useColorTheme = () => React.useContext(ColorThemeContext);

const THEME_KEY = "monotes-color-theme-v2";
const LEGACY_THEME_KEY = "monotes-color-theme";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  const [activeTheme, setActiveThemeState] = React.useState<ThemePreset | null>(
    null
  );
  const [isLoading, setIsLoading] = React.useState(true);

  // Load from local storage on mount
  React.useEffect(() => {
    // A theme chosen before the Sodium redesign no longer applies: Sodium is
    // the default, and a theme picked since is stored under the new key.
    localStorage.removeItem(LEGACY_THEME_KEY);
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
      try {
        setActiveThemeState(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved theme", e);
      }
    }
    setIsLoading(false);
  }, []);

  const setActiveTheme = (theme: ThemePreset | null) => {
    setActiveThemeState(theme);
    if (theme) {
      localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    } else {
      localStorage.removeItem(THEME_KEY);
    }
  };

  return (
    <NextThemesProvider {...props}>
      <ColorThemeContext.Provider
        value={{ activeTheme, setActiveTheme, isLoading }}
      >
        <ThemeInjector activeTheme={activeTheme} />
        {children}
      </ColorThemeContext.Provider>
    </NextThemesProvider>
  );
}

function ThemeInjector({ activeTheme }: { activeTheme: ThemePreset | null }) {
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    if (!activeTheme) return;

    let rawVars = activeTheme.cssVars;

    // Mixed/Dark logic
    if (resolvedTheme === "dark" && activeTheme.cssVarsRaw?.dark) {
      rawVars = {
        ...(activeTheme.cssVarsRaw.theme || {}),
        ...(activeTheme.cssVarsRaw.dark || {}),
      };
    }

    // Sodium's roles live on the .sodium element (body), so the theme is
    // translated into them and set there rather than on <html>.
    const vars = sodiumVarsFromTheme(rawVars);
    applySodiumVars(document.body, vars);
    return () => clearSodiumVars(document.body, vars);
  }, [activeTheme, resolvedTheme]);

  return null;
}
