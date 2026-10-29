import { lineDiff } from "@/lib/collab/line-diff";
import { cn } from "@/lib/sodium/utils";

/* Line-by-line comparison; removed lines are struck through, added lines highlighted. */
export default function LineDiffView({ before, after, label }: { before: string; after: string; label: string }) {
  const lines = lineDiff(before, after);
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-72 overflow-auto border border-line-faint bg-code-surface py-1 type-code-sm text-text-1"
    >
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "whitespace-pre-wrap px-2",
            line.kind === "added" && "bg-ok-tint",
            line.kind === "removed" && "bg-fail-tint text-text-2 line-through",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "mr-2 select-none text-text-3",
              line.kind === "added" && "text-ok-text",
              line.kind === "removed" && "text-fail-text",
            )}
          >
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
          </span>
          <span className="sr-only">{line.kind === "added" ? "Added: " : line.kind === "removed" ? "Removed: " : ""}</span>
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}
