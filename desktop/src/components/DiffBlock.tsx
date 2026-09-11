import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileDiff } from "lucide-react";
import { computeLineDiff, parseUnifiedDiff, type DiffLine, type DiffPayload } from "../diff";

const EXPANDED_CHANGE_CAP = 60;
const RENDER_LINE_CAP = 400;

function fileName(path: string) {
  const parts = path.split("/");
  const name = parts[parts.length - 1] || path;
  return { name, dir: parts.length > 1 ? parts.slice(0, -1).join("/") : "" };
}

export function DiffLines({ lines }: { lines: DiffLine[] }) {
  const [expandedCap, setExpandedCap] = useState(RENDER_LINE_CAP);
  const visible = lines.length > expandedCap ? lines.slice(0, expandedCap) : lines;
  const hidden = lines.length - visible.length;
  let oldLine = 0;
  let newLine = 0;
  const numbered = visible.map((line) => {
    const row = { line, old: 0, next: 0 };
    if (line.type !== "add") {
      oldLine += 1;
      row.old = oldLine;
    }
    if (line.type !== "del") {
      newLine += 1;
      row.next = newLine;
    }
    return row;
  });
  return (
    <div className="diff-body">
      {numbered.map(({ line, old, next }, index) => (
        <div key={index} className={`diff-row diff-row-${line.type}`}>
          <span className="diff-lineno">{line.type === "add" ? "" : old}</span>
          <span className="diff-lineno">{line.type === "del" ? "" : next}</span>
          <span className="diff-gutter">{line.type === "add" ? "+" : line.type === "del" ? "−" : ""}</span>
          <span className="diff-text">{line.text || " "}</span>
        </div>
      ))}
      {hidden > 0 && (
        <button
          onClick={() => setExpandedCap((cap) => cap + RENDER_LINE_CAP)}
          className="diff-more"
        >
          Show {Math.min(hidden, RENDER_LINE_CAP)} more of {hidden} hidden lines
        </button>
      )}
    </div>
  );
}

export function DiffBlock({
  path,
  oldText,
  newText,
  diff,
}: {
  path?: string;
  oldText?: string | null;
  newText?: string;
  diff?: string;
}) {
  const resolved = useMemo(() => {
    if (diff !== undefined) {
      const parsed = parseUnifiedDiff(diff);
      if (!parsed) return { path, lines: [] as DiffLine[] };
      return { path: path ?? parsed.path, lines: parsed.lines };
    }
    return { path, lines: computeLineDiff(oldText ?? "", newText ?? "") };
  }, [diff, path, oldText, newText]);

  const changed = useMemo(
    () => resolved.lines.filter((line) => line.type !== "context"),
    [resolved.lines],
  );
  const added = changed.filter((line) => line.type === "add").length;
  const removed = changed.filter((line) => line.type === "del").length;
  const isNew = oldText === null;
  const heavy = changed.length > EXPANDED_CHANGE_CAP;
  const [open, setOpen] = useState(!heavy);
  const name = resolved.path ? fileName(resolved.path) : undefined;

  return (
    <div className="diff-block" data-testid="diff-block">
      <button onClick={() => setOpen(!open)} className="diff-header">
        {open ? (
          <ChevronDown size={12} className="shrink-0 text-text-secondary" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-text-secondary" />
        )}
        <FileDiff size={12} className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px]">
          {name ? (
            <>
              <span className="text-foreground">{name.name}</span>
              {name.dir && <span className="text-text-secondary"> {name.dir}</span>}
            </>
          ) : (
            <span className="text-text-secondary">File edit</span>
          )}
        </span>
        {isNew && (
          <span className="shrink-0 text-[10px] text-success">new file</span>
        )}
        <span className="shrink-0 font-mono text-[10px]">
          <span className="text-success">+{added}</span>
          {" "}
          <span className="text-error">−{removed}</span>
        </span>
      </button>
      {open && changed.length > 0 && <DiffLines lines={resolved.lines} />}
      {open && changed.length === 0 && (
        <div className="px-2.5 pb-2 pt-0.5 text-[11px] text-text-secondary">No changes</div>
      )}
    </div>
  );
}

export function ToolCallDiffs({ diffs }: { diffs: DiffPayload[] }) {
  return (
    <div className="space-y-1.5">
      {diffs.map((payload, index) => (
        <DiffBlock
          key={`${payload.path ?? "file"}-${index}`}
          path={payload.path}
          oldText={payload.oldText}
          newText={payload.newText}
        />
      ))}
    </div>
  );
}
