"use client";

import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { DiffLine, ParsedDiff } from "@/lib/tool-streaming";
import { splitPath } from "@/lib/tool-streaming";
import type { PiToolUIPart } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ToolRendererProps = { part: PiToolUIPart };

/**
 * Shared shell for tool-call rows. Design rules:
 * - a finished call is one quiet 38px line; success has no badge
 * - status is conveyed by motion (shimmer while args stream, spinner
 *   while running) and color only on error
 * - the expandable body is tool-specific and provided as children
 */

export const TOOL_ICON_CLASS = "size-[15px] shrink-0 text-muted-foreground";

export function ToolSpinner({ className }: { className?: string }) {
  return (
    <output
      aria-label="Running"
      className={cn(
        "inline-block size-[13px] shrink-0 animate-spin rounded-full border-[1.5px] border-border border-t-muted-foreground",
        className
      )}
    />
  );
}

/** Mono subject text; shimmers while its source is still streaming. */
export function ToolSubject({
  children,
  shimmer,
  text,
}: {
  children?: ReactNode;
  shimmer?: boolean;
  text?: string;
}) {
  if (shimmer && text !== undefined) {
    return (
      <Shimmer
        as="span"
        className="min-w-0 truncate font-mono text-xs"
        duration={1.4}
      >
        {text}
      </Shimmer>
    );
  }
  return (
    <span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
      {children ?? text}
    </span>
  );
}

/** Directory dimmed, filename emphasized, optional `:12–80` range. */
export function FilePathText({
  path,
  range,
}: {
  path: string;
  range?: string;
}) {
  const { dir, name } = splitPath(path);
  return (
    <>
      {dir}
      <span className="text-foreground">{name}</span>
      {range && <span className="opacity-75">{range}</span>}
    </>
  );
}

export function AddRemoveCounts({
  added,
  removed,
  showRemoved = true,
}: {
  added: number;
  removed: number;
  showRemoved?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 font-mono font-semibold text-[11px] tabular-nums">
      <span className="text-[var(--tool-add-fg)]">+{added}</span>
      {showRemoved && (
        <span className="text-[var(--tool-del-fg)]">−{removed}</span>
      )}
    </span>
  );
}

export function ToolChip({
  children,
  error,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-px font-medium text-[10.5px]",
        error
          ? "border-destructive/40 bg-destructive/5 font-mono font-semibold text-destructive"
          : "border-border bg-secondary text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

export type ToolRowProps = {
  icon: ReactNode;
  /** Action verb, e.g. "Read". Omit for MCP rows that lead with a chip. */
  verb?: string;
  subject?: ReactNode;
  /** Right-aligned meta: counts, durations, chips, spinner. */
  meta?: ReactNode;
  running?: boolean;
  error?: boolean;
  /**
   * Desired open state while the user hasn't toggled the row themselves;
   * lets rows auto-open while running and settle closed after.
   */
  autoOpen?: boolean;
  children?: ReactNode;
};

export function ToolRow({
  icon,
  verb,
  subject,
  meta,
  running,
  error,
  autoOpen = false,
  children,
}: ToolRowProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const hasBody = children !== undefined && children !== null;
  const open = hasBody && (userOpen ?? autoOpen);

  const containerClass = cn(
    "group not-prose mb-2 w-full min-w-0 max-w-[760px] overflow-hidden rounded-[var(--radius)] border bg-card text-[13px] shadow-[var(--shadow-card)]",
    error && "border-destructive/35"
  );

  const headerContent = (
    <>
      <span className={cn("contents", error && "[&_svg]:text-destructive")}>
        {icon}
      </span>
      {verb && <span className="shrink-0 font-medium">{verb}</span>}
      {subject}
      <span className="ml-auto flex shrink-0 items-center gap-2.5 text-[11.5px] text-muted-foreground tabular-nums">
        {meta}
        {running && <ToolSpinner />}
      </span>
      {hasBody && (
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      )}
    </>
  );

  // Without a body the header is a plain div so meta can hold buttons
  // (nesting them inside a Radix trigger would be a button in a button).
  if (!hasBody) {
    return (
      <div className={containerClass} data-testid="pi-tool-block">
        <div className="flex min-h-[38px] w-full items-center gap-2.5 px-3 py-2 text-left">
          {headerContent}
        </div>
      </div>
    );
  }

  return (
    <Collapsible
      className={containerClass}
      data-testid="pi-tool-block"
      onOpenChange={setUserOpen}
      open={open}
    >
      <CollapsibleTrigger className="flex min-h-[38px] w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/45">
        {headerContent}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Error message body, mono and destructive-tinted, with optional hint. */
export function ToolErrorBody({
  message,
  hint,
}: {
  message: string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <div className="whitespace-pre-wrap break-words px-3.5 py-2.5 font-mono text-destructive text-xs leading-relaxed">
        {message}
      </div>
      {hint && (
        <div className="px-3.5 pb-3 text-muted-foreground text-xs">{hint}</div>
      )}
    </div>
  );
}

/**
 * A body pane that caps its height with a bottom fade and a
 * "Show all" affordance; in `follow` mode it sticks to the newest
 * content while streaming unless the user scrolls away.
 */
export function CappedPane({
  children,
  expandLabel = "Show all",
  fadeToClass = "to-card",
  follow = false,
  lineCount = 0,
  maxHeight = 300,
}: {
  children: ReactNode;
  expandLabel?: string;
  /** Bottom-fade target color; override for dark panes (terminal). */
  fadeToClass?: string;
  follow?: boolean;
  lineCount?: number;
  maxHeight?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Runs after every render on purpose: streamed content growing inside
  // `children` must keep the pane pinned to the newest line, and no dep
  // array can express "children content changed".
  useEffect(() => {
    if (!follow || expanded || !pinnedRef.current) {
      return;
    }
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  });

  const capped = !expanded && lineCount > 12;

  return (
    <div>
      <div
        className={cn("relative", capped && "overflow-hidden")}
        style={capped ? { maxHeight } : undefined}
      >
        <div
          className={cn(capped && follow && "overflow-y-auto")}
          onScroll={(event) => {
            const node = event.currentTarget;
            pinnedRef.current =
              node.scrollTop + node.clientHeight >= node.scrollHeight - 8;
          }}
          ref={scrollRef}
          style={capped && follow ? { maxHeight } : undefined}
        >
          {children}
        </div>
        {capped && !follow && (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-gradient-to-b from-transparent",
              fadeToClass
            )}
          />
        )}
      </div>
      {capped && (
        <button
          className="block w-full border-t py-1.5 text-center font-medium text-[11.5px] text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(true);
          }}
          type="button"
        >
          {expandLabel}
        </button>
      )}
    </div>
  );
}

/** Plain line-numbered mono pane for source excerpts and text output. */
export function CodePane({
  text,
  startLine,
  className,
}: {
  text: string;
  startLine?: number;
  className?: string;
}) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <pre
      className={cn(
        "overflow-x-auto py-2.5 font-mono text-xs leading-relaxed",
        className
      )}
    >
      {lines.map((line, index) => (
        <span className="block pr-3.5" key={`l-${index + (startLine ?? 1)}`}>
          {startLine !== undefined && (
            <span className="inline-block w-11 select-none pr-3.5 text-right text-muted-foreground/55 tabular-nums">
              {startLine + index}
            </span>
          )}
          {startLine === undefined && <span className="inline-block w-3.5" />}
          {line}
        </span>
      ))}
    </pre>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  if (line.kind === "gap") {
    return (
      <div className="my-1 border-border border-y border-dashed py-0.5 text-center text-[11px] text-muted-foreground/60 tracking-[0.2em]">
        ⋯
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex whitespace-pre",
        line.kind === "add" && "bg-[var(--tool-add-bg)]",
        line.kind === "del" && "bg-[var(--tool-del-bg)]"
      )}
    >
      <span className="w-10 shrink-0 select-none pr-2.5 text-right text-muted-foreground/50 tabular-nums">
        {line.lineNumber ?? ""}
      </span>
      <span
        className={cn(
          "w-4 shrink-0 select-none font-semibold",
          line.kind === "add" && "text-[var(--tool-add-fg)]",
          line.kind === "del" && "text-[var(--tool-del-fg)]"
        )}
      >
        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
      </span>
      <span className="flex-1 pr-3.5">{line.text}</span>
    </div>
  );
}

/** Renders a parsed diff (authoritative or provisional). */
export function DiffView({
  diff,
  expandLabel = "Show full diff",
  footer,
}: {
  diff: Pick<ParsedDiff, "lines">;
  expandLabel?: string;
  footer?: ReactNode;
}) {
  return (
    <CappedPane
      expandLabel={expandLabel}
      lineCount={diff.lines.length}
      maxHeight={340}
    >
      <div className="overflow-x-auto py-2 font-mono text-xs leading-relaxed">
        {diff.lines.map((line, index) => (
          <DiffRow
            key={`${index}-${line.kind}-${line.lineNumber ?? ""}`}
            line={line}
          />
        ))}
      </div>
      {footer}
    </CappedPane>
  );
}

/** Key-value grid for tool arguments (MCP and generic fallback). */
export function ArgsGrid({
  args,
  streaming,
}: {
  args: Record<string, unknown>;
  streaming?: boolean;
}) {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return null;
  }
  return (
    <dl className="space-y-1 px-3.5 py-3 text-xs">
      {entries.map(([key, value], index) => {
        const rendered =
          typeof value === "string" ? value : JSON.stringify(value, null, 2);
        const isLast = index === entries.length - 1;
        return (
          <div className="grid grid-cols-[110px_1fr] gap-x-4" key={key}>
            <dt className="pt-px font-mono text-[11px] text-muted-foreground">
              {key}
            </dt>
            <dd className="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-secondary-foreground">
              {streaming && isLast ? (
                <Shimmer as="span" className="font-mono text-xs" duration={1.4}>
                  {rendered}
                </Shimmer>
              ) : (
                rendered
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Elapsed time for a running tool, measured client-side from the first
 * render where `active` is true; freezes at its last value when done.
 */
export function useElapsedMs(active: boolean): number | null {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (startRef.current === null) {
      startRef.current = Date.now();
    }
    const start = startRef.current;
    const interval = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, [active]);

  return elapsed;
}
