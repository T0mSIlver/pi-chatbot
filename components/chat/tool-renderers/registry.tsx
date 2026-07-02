"use client";

import type { PiToolUIPart } from "@/lib/types";
import { BashToolRow } from "./bash";
import { EditToolRow } from "./edit";
import { FetchWebpageToolRow } from "./fetch-webpage";
import { GrepToolRow } from "./grep";
import { FindToolRow, LsToolRow } from "./ls-find";
import { McpToolRow } from "./mcp";
import { ReadToolRow } from "./read";
import type { ToolRendererProps } from "./shared";
import { ShowcaseToolRow } from "./showcase";
import { WriteToolRow } from "./write";

const renderers: Record<string, (props: ToolRendererProps) => React.ReactNode> =
  {
    bash: BashToolRow,
    edit: EditToolRow,
    fetch_webpage: FetchWebpageToolRow,
    find: FindToolRow,
    grep: GrepToolRow,
    ls: LsToolRow,
    read: ReadToolRow,
    showcase_file: ShowcaseToolRow,
    write: WriteToolRow,
  };

/**
 * Renders a tool-pi part with its tool-specific renderer. Unknown names
 * (MCP tools and anything future) fall back to the MCP renderer, which
 * degrades gracefully when no server identity is present.
 */
export function PiToolPart({ part }: { part: PiToolUIPart }) {
  const Renderer = renderers[part.toolName] ?? McpToolRow;
  return <Renderer part={part} />;
}
