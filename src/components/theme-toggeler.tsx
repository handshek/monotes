"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/sodium/ui/button";
import { Icon, Desktop, Moon, Sun } from "@/components/sodium/icon";

export default function ThemeToggeler() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Holds the button's place until the stored theme is known.
    return (
      <Button variant="ghost" size="icon" aria-label="Toggle theme">
        <span className="size-(--icon)" />
      </Button>
    );
  }

  const cycleTheme = () => {
    if (theme === "light") {
      setTheme("dark");
    } else if (theme === "dark") {
      setTheme("system");
    } else {
      setTheme("light");
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      aria-label="Toggle theme"
    >
      {theme === "light" && <Icon icon={Sun} />}
      {theme === "dark" && <Icon icon={Moon} />}
      {(theme === "system" || !theme) && <Icon icon={Desktop} />}
    </Button>
  );
}
