"use client";

import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  TOOL_ICON_CLASS,
  ToolChip,
  ToolErrorBody,
  type ToolRendererProps,
  ToolRow,
  ToolSubject,
} from "@/components/chat/tool-renderers/shared";
import {
  classifyFetchError,
  formatCharCount,
  getToolArgs,
  normalizeToolOutput,
} from "@/lib/tool-streaming";

function displayUrlParts(url: string): { domain: string; rest: string } {
  const stripped = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const separator = stripped.indexOf("/");
  if (separator === -1) {
    return { domain: stripped, rest: "" };
  }
  return {
    domain: stripped.slice(0, separator),
    rest: stripped.slice(separator),
  };
}

function extractTitle(text: string): { title?: string; body: string } {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (frontmatterMatch) {
    const titleMatch = /^title:\s*(.*)$/m.exec(frontmatterMatch[1]);
    return {
      title: titleMatch?.[1]?.trim(),
      body: text.slice(frontmatterMatch[0].length),
    };
  }

  const titleLineMatch = /^Title:\s*(.*)$/.exec(text.split("\n", 1)[0]);
  if (titleLineMatch) {
    return {
      title: titleLineMatch[1].trim(),
      body: text.slice(titleLineMatch[0].length).replace(/^\n/, ""),
    };
  }

  return { body: text };
}

export function FetchWebpageToolRow({ part }: ToolRendererProps) {
  const { args, streaming } = getToolArgs(part);
  const output = normalizeToolOutput(part.output);
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const isError = part.state === "output-error";
  const settled = part.state === "output-available";

  const url = typeof args.url === "string" ? args.url : undefined;

  const subject =
    url === undefined ? (
      <ToolSubject shimmer text="…" />
    ) : streaming ? (
      <ToolSubject shimmer text={url} />
    ) : (
      <ToolSubject>
        {(() => {
          const { domain, rest } = displayUrlParts(url);
          return (
            <>
              <span className="text-foreground">{domain}</span>
              {rest}
            </>
          );
        })()}
      </ToolSubject>
    );

  const meta = settled ? (
    <>
      {formatCharCount(output.text?.length ?? 0)}
      {output.details?.truncated === true && <ToolChip>truncated</ToolChip>}
    </>
  ) : isError ? (
    <ToolChip error>{classifyFetchError(part.errorText ?? "").chip}</ToolChip>
  ) : undefined;

  const openOriginal = url ? (
    <a
      className="mt-2 inline-flex items-center gap-1 font-medium text-[11.5px] text-secondary-foreground hover:text-foreground"
      href={url}
      rel="noopener noreferrer"
      target="_blank"
    >
      Open original <ExternalLinkIcon className="size-3" />
    </a>
  ) : undefined;

  let body: ReactNode;
  if (isError) {
    const info = classifyFetchError(part.errorText ?? "Fetch failed");
    body = (
      <ToolErrorBody
        hint={
          info.hint || openOriginal ? (
            <>
              {info.hint}
              {openOriginal}
            </>
          ) : undefined
        }
        message={info.message}
      />
    );
  } else if (settled && output.text) {
    const { title, body: rest } = extractTitle(output.text);
    const cut = rest.length > 1000;
    const excerpt = cut ? `${rest.slice(0, 1000)}…` : rest;
    body = (
      <div className="px-3.5 py-3">
        {title && (
          <h4 className="mb-1.5 font-medium text-[13px] text-foreground">
            {title}
          </h4>
        )}
        <p className="whitespace-pre-wrap break-words text-muted-foreground text-xs leading-relaxed">
          {excerpt}
        </p>
        {openOriginal}
      </div>
    );
  }

  return (
    <ToolRow
      autoOpen={settled || isError}
      error={isError}
      icon={<GlobeIcon className={TOOL_ICON_CLASS} />}
      meta={meta}
      running={running}
      subject={subject}
      verb="Fetch"
    >
      {body}
    </ToolRow>
  );
}
