import { useEffect, useRef } from "react";
import { Vim } from "@replit/codemirror-vim";

/* Register :w and the user's custom Vim mappings while Vim mode is on. */
export function useVimCommands(enabled: boolean, commands: string, onWrite: () => boolean) {
  // Track applied Vim mappings to cleanup later
  const appliedMappings = useRef<{ lhs: string; mode: string }[]>([]);

  useEffect(() => {
    if (!enabled) return;

    // Clean up previous mappings
    appliedMappings.current.forEach(({ lhs, mode }) => {
      try {
        Vim.unmap(lhs, mode);
      } catch {
        // Ignore unmap errors
      }
    });
    appliedMappings.current = [];

    Vim.defineEx("write", "w", onWrite);

    const lines = commands.split("\n");
    lines.forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) return;

      const [cmd, lhs, ...rhsParts] = parts;
      const rhs = rhsParts.join(" ");
      let mode = "normal";

      if (cmd.startsWith("i")) mode = "insert";
      else if (cmd.startsWith("v")) mode = "visual";
      else if (cmd.startsWith("n")) mode = "normal";

      // Map keys
      if (cmd.includes("nore")) {
        Vim.noremap(lhs, rhs, mode);
      } else {
        Vim.map(lhs, rhs, mode);
      }

      appliedMappings.current.push({ lhs, mode });
    });
  }, [enabled, commands, onWrite]);
}
