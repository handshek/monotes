"use client";

import { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { BUILT_IN_THEMES, fetchThemeFromUrl } from "@/lib/themes";
import { useColorTheme } from "@/components/theme-provider";
import { useThemes, PreviewColors } from "@/hooks/useThemes";
import {
  Icon,
  Checkmark,
  Close,
} from "@/components/sodium/icon";
import { Button } from "@/components/sodium/ui/button";
import { Input, InputAction } from "@/components/sodium/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/sodium/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/sodium/ui/item";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/sodium/ui/segmented-control";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyIcon,
  EmptyTitle,
} from "@/components/sodium/ui/empty-state";
import { cn } from "@/lib/sodium/utils";

// A theme's preview colours are the theme's own data, so they are set inline; the squares around them use tokens.
// Sodium's own palette, as fixed values: the live roles would show whichever theme is active.
const SODIUM_PREVIEW: Record<"light" | "dark", PreviewColors> = {
  light: { background: "#ffffff", primary: "#ffd400", secondary: "#fafaf7", accent: "#fff4bf", muted: "#f4f3ee" },
  dark: { background: "#141412", primary: "#ffd400", secondary: "#1c1b19", accent: "#3a3107", muted: "#22211e" },
};

function ColorPreview({ colors }: { colors: PreviewColors | null }) {
  const hasValidColors = colors && (colors.primary || colors.background);

  const colorList = hasValidColors
    ? [
        { value: colors.background, label: "Background" },
        { value: colors.primary, label: "Primary" },
        { value: colors.secondary, label: "Secondary" },
        { value: colors.accent, label: "Accent" },
        { value: colors.muted, label: "Muted" },
      ]
    : null;

  return (
    <div className="flex gap-1" aria-hidden>
      {colorList
        ? colorList.map((color, i) => (
            <span
              key={i}
              className="size-3 border border-line"
              style={color.value ? { backgroundColor: color.value } : undefined}
              title={color.label}
            />
          ))
        : [...Array(5)].map((_, i) => (
            <span key={i} className="size-3 border border-line-faint bg-well" />
          ))}
    </div>
  );
}

function ThemeSearchEmptyState({ query }: { query: string }) {
  const trimmedQuery = query.trim();

  return (
    <Empty reason="no-results" variant="plain" size="sm">
      <EmptyIcon />
      <EmptyHeader>
        <EmptyTitle>
          {trimmedQuery
            ? `No themes found for "${trimmedQuery}".`
            : "No themes match your search."}
        </EmptyTitle>
        <EmptyDescription>
          Try a different name or clear the search filter.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

interface ThemeRowProps {
  name: string;
  media: React.ReactNode;
  active: boolean;
  loading?: boolean;
  failed?: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}

/** One theme in the list: its swatches, its name, and the checkmark when it is the active one. */
function ThemeRow({
  name,
  media,
  active,
  loading = false,
  failed = false,
  onSelect,
  onRemove,
}: ThemeRowProps) {
  return (
    <Item size="sm" selected={active} disabled={loading}>
      <ItemMedia className="w-20 justify-start">{media}</ItemMedia>
      <ItemContent>
        <ItemTitle>
          <ButtonPrimitive
            data-slot="item-link"
            data-control=""
            aria-pressed={active}
            aria-busy={loading || undefined}
            disabled={loading}
            onClick={onSelect}
            className={cn(
              "min-w-0 cursor-pointer truncate text-start after:absolute after:inset-0",
              loading && "cursor-wait",
            )}
          >
            {name}
          </ButtonPrimitive>
        </ItemTitle>
      </ItemContent>
      {loading && <span className="pending text-text-2" aria-hidden />}
      {failed && <span className="type-label-sm text-fail-text">Failed</span>}
      {active && <Icon icon={Checkmark} className="shrink-0" />}
      {onRemove && (
        <ItemActions>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove theme"
            title="Remove theme"
            onClick={onRemove}
          >
            <Icon icon={Close} />
          </Button>
        </ItemActions>
      )}
    </Item>
  );
}

function ModeControl() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const labelId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex items-center justify-between gap-3">
      <FieldTitle id={labelId}>Mode</FieldTitle>
      <SegmentedControl
        aria-labelledby={labelId}
        value={mounted ? (theme ?? "system") : "system"}
        onValueChange={(value) => setTheme(value)}
      >
        <SegmentedControlItem value="light">Light</SegmentedControlItem>
        <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
        <SegmentedControlItem value="system">System</SegmentedControlItem>
      </SegmentedControl>
    </div>
  );
}

export default function AppearanceSettings() {
  const { activeTheme, setActiveTheme } = useColorTheme();
  const {
    themes,
    customThemeNames,
    getPreviewColors,
    addCustomTheme,
    removeCustomTheme,
    existingTheme,
  } = useThemes();
  const { resolvedTheme } = useTheme();
  const [customThemeUrl, setCustomThemeUrl] = useState("");
  const [isLoadingCustom, setIsLoadingCustom] = useState(false);
  const [error, setError] = useState("");
  const [themeSearch, setThemeSearch] = useState("");

  const mode = resolvedTheme === "dark" ? "dark" : "light";

  const handleThemeSelect = (themeName: string) => {
    const state = themes.get(themeName);
    if (state?.theme) {
      setActiveTheme(state.theme);
    }
  };

  const handleImportTheme = async () => {
    if (!customThemeUrl) return;
    setIsLoadingCustom(true);
    setError("");
    try {
      const theme = await fetchThemeFromUrl(customThemeUrl);
      if (theme) {
        if (existingTheme(theme.name)) {
          setError("Theme with that name already exists");
          return;
        }
        addCustomTheme(theme);
        setActiveTheme(theme);
        setCustomThemeUrl("");
      } else {
        setError("Failed to load theme. Please check the URL.");
      }
    } catch {
      setError("An error occurred while importing the theme.");
    } finally {
      setIsLoadingCustom(false);
    }
  };

  const handleRemoveCustomTheme = (themeName: string) => {
    // If the active theme is being removed, reset to default
    if (activeTheme?.name === themeName) {
      setActiveTheme(null);
    }
    removeCustomTheme(themeName);
  };

  // Get custom themes for display
  const customThemeEntries = Array.from(themes.entries()).filter(([name]) =>
    customThemeNames.has(name),
  );

  const searchQuery = themeSearch.trim().toLowerCase();
  const hasSearch = searchQuery.length > 0;

  const filteredBuiltInThemes = hasSearch
    ? BUILT_IN_THEMES.filter((theme) =>
        theme.name.toLowerCase().includes(searchQuery),
      )
    : BUILT_IN_THEMES;

  const filteredCustomThemeEntries = hasSearch
    ? customThemeEntries.filter(([themeName, state]) => {
        const name = (state.theme?.name || themeName).toLowerCase();
        return name.includes(searchQuery);
      })
    : customThemeEntries;

  const hasThemeResults =
    filteredBuiltInThemes.length > 0 || filteredCustomThemeEntries.length > 0;

  const showEmptyState = hasSearch && !hasThemeResults;

  return (
    <div className="flex flex-col gap-6">
      <p className="type-body-sm text-text-2">
        Customize the look and feel of the application.
      </p>

      <ModeControl />

      <section className="flex flex-col gap-2" aria-labelledby="theme-list-label">
        <FieldTitle id="theme-list-label">Theme</FieldTitle>
        <Input
          mode="search"
          aria-label="Search themes"
          placeholder="Search themes"
          value={themeSearch}
          onValueChange={setThemeSearch}
        />

        {showEmptyState && <ThemeSearchEmptyState query={themeSearch} />}

        <ItemGroup aria-labelledby="theme-list-label">
          <ThemeRow
            name="Sodium"
            media={<ColorPreview colors={SODIUM_PREVIEW[mode]} />}
            active={activeTheme === null}
            onSelect={() => setActiveTheme(null)}
          />

          {filteredBuiltInThemes.map((theme) => {
            const state = themes.get(theme.name);
            return (
              <ThemeRow
                key={theme.name}
                name={theme.name}
                media={
                  <ColorPreview colors={getPreviewColors(theme.name, mode)} />
                }
                active={activeTheme?.name === theme.name}
                loading={state?.isLoading}
                failed={!!state?.error && !state.theme}
                onSelect={() => handleThemeSelect(theme.name)}
              />
            );
          })}

          {/* Custom imported themes */}
          {filteredCustomThemeEntries.map(([themeName, state]) => (
            <ThemeRow
              key={themeName}
              name={state.theme?.name || themeName}
              media={
                <ColorPreview colors={getPreviewColors(themeName, mode)} />
              }
              active={activeTheme?.name === themeName}
              onSelect={() => handleThemeSelect(themeName)}
              onRemove={() => handleRemoveCustomTheme(themeName)}
            />
          ))}
        </ItemGroup>
      </section>

      <Field invalid={!!error}>
        <FieldLabel>Custom theme</FieldLabel>
        <Input
          type="url"
          mono
          autoComplete="off"
          placeholder="Paste a tweakcn.com URL"
          value={customThemeUrl}
          onValueChange={setCustomThemeUrl}
          trailing={
            <InputAction
              size="text"
              variant="primary"
              pending={isLoadingCustom}
              disabled={!customThemeUrl}
              onClick={handleImportTheme}
            >
              Import
            </InputAction>
          }
        />
        {error && <FieldError>{error}</FieldError>}
        <FieldDescription>
          Import themes from{" "}
          <a href="https://tweakcn.com" target="_blank" rel="noopener noreferrer">
            tweakcn.com
          </a>
          .
        </FieldDescription>
      </Field>
    </div>
  );
}
