"use client";

import type { ComponentProps } from "react";

import { copyTextToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type MarkdownTableProps = ComponentProps<"table"> & {
  node?: unknown;
};

function tableRows(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll("tr"))
    .map((row) =>
      Array.from(row.querySelectorAll("th,td")).map((cell) =>
        (cell.textContent ?? "").replace(/\s+/g, " ").trim()
      )
    )
    .filter((row) => row.length > 0);
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function tableToMarkdown(table: HTMLTableElement) {
  const rows = tableRows(table);
  if (rows.length === 0) {
    return "";
  }

  const width = Math.max(...rows.map((row) => row.length));
  const normalize = (row: string[]) =>
    Array.from({ length: width }, (_, index) =>
      escapeMarkdownCell(row[index] ?? "")
    );
  const header = normalize(rows[0]);
  const separator = Array.from({ length: width }, () => "---");
  const body = rows.slice(1).map(normalize);

  return [header, separator, ...body]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function escapeCsvCell(value: string) {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function tableToCsv(table: HTMLTableElement) {
  return tableRows(table)
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function MarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: MarkdownTableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopyMarkdown = () => {
    const table = tableRef.current;
    if (!table) {
      return;
    }
    const markdown = tableToMarkdown(table);
    void copyTextToClipboard(markdown).then(() => setCopied(true));
  };

  const handleDownloadCsv = () => {
    const table = tableRef.current;
    if (!table) {
      return;
    }
    downloadText(
      "table.csv",
      `\uFEFF${tableToCsv(table)}`,
      "text/csv;charset=utf-8"
    );
  };

  return (
    <div
      className="my-4 flex max-w-full flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-2"
      data-streamdown="table-wrapper"
    >
      <div className="flex items-center justify-end gap-1">
        <button
          aria-label="Copy table as Markdown"
          className="flex size-10 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={handleCopyMarkdown}
          title="Copy table as Markdown"
          type="button"
        >
          {copied ? (
            <CheckIcon className="size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </button>
        <button
          aria-label="Download table as CSV"
          className="flex size-10 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={handleDownloadCsv}
          title="Download table as CSV"
          type="button"
        >
          <DownloadIcon className="size-3.5" />
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Copied table as Markdown" : ""}
        </span>
      </div>
      <div className="max-w-full overflow-x-auto rounded-md border border-border/60 bg-background">
        <table
          className={cn("w-full divide-y divide-border", className)}
          data-streamdown="table"
          ref={tableRef}
          {...props}
        >
          {children}
        </table>
      </div>
    </div>
  );
}
