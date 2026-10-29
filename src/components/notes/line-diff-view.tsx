import { lineDiff } from "@/lib/collab/line-diff";
import { cn } from "@/lib/utils";

/* Line-by-line comparison; removed lines are struck through, added lines highlighted. */
export default function LineDiffView({ before, after, label }: { before: string; after: string; label: string }) {
  const lines = lineDiff(before, after);
  return (
    <div role="region" aria-label={label} className="max-h-72 overflow-auto rounded-md border font-mono text-xs">
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            "whitespace-pre-wrap px-2 py-px",
            line.kind === "added" && "bg-green-500/15",
            line.kind === "removed" && "bg-red-500/15 line-through decoration-red-500/60",
          )}
        >
          <span aria-hidden="true" className="mr-2 select-none text-muted-foreground">
            {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
          </span>
          <span className="sr-only">{line.kind === "added" ? "Added: " : line.kind === "removed" ? "Removed: " : ""}</span>
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}
