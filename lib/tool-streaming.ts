/**
 * Pure helpers shared by the per-tool chat renderers.
 *
 * Everything here operates on data that is potentially incomplete: tool
 * arguments arrive as partial JSON text while the model is still writing
 * them, and tool output can be a live preview. The rule the renderers
 * follow is "provisional while streaming, authoritative on tool-end" —
 * these helpers never throw on truncated input.
 */

// ---------------------------------------------------------------------------
// Tolerant partial JSON parser
// ---------------------------------------------------------------------------

type ParseResult = { value: unknown; end: number } | null;

function skipWhitespace(source: string, index: number) {
  let i = index;
  while (i < source.length && /\s/.test(source[i])) {
    i += 1;
  }
  return i;
}

function parsePartialString(source: string, start: number): ParseResult {
  let result = "";
  let i = start + 1;

  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      return { value: result, end: i + 1 };
    }
    if (char === "\\") {
      const next = source[i + 1];
      if (next === undefined) {
        // Incomplete escape at end of stream — drop it.
        return { value: result, end: source.length };
      }
      if (next === "u") {
        const hex = source.slice(i + 2, i + 6);
        if (hex.length < 4) {
          return { value: result, end: source.length };
        }
        const code = Number.parseInt(hex, 16);
        if (!Number.isNaN(code)) {
          result += String.fromCharCode(code);
        }
        i += 6;
        continue;
      }
      const escapes: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      result += escapes[next] ?? next;
      i += 2;
      continue;
    }
    result += char;
    i += 1;
  }

  // Unterminated string — return what has streamed in so far.
  return { value: result, end: source.length };
}

function parsePartialNumber(source: string, start: number): ParseResult {
  const match = /^-?\d*(?:\.\d*)?(?:[eE][+-]?\d*)?/.exec(source.slice(start));
  if (!match || match[0].length === 0) {
    return null;
  }
  const raw = match[0];
  const value = Number(raw);
  return {
    value: Number.isNaN(value) ? undefined : value,
    end: start + raw.length,
  };
}

function parsePartialLiteral(source: string, start: number): ParseResult {
  for (const [literal, value] of [
    ["true", true],
    ["false", false],
    ["null", null],
  ] as const) {
    const slice = source.slice(start, start + literal.length);
    if (literal.startsWith(slice) && slice.length > 0) {
      if (slice === literal) {
        return { value, end: start + literal.length };
      }
      // Partial literal at end of stream (e.g. "tru").
      if (start + slice.length === source.length) {
        return { value, end: source.length };
      }
    }
  }
  return null;
}

function parsePartialArray(source: string, start: number): ParseResult {
  const items: unknown[] = [];
  let i = start + 1;

  while (i < source.length) {
    i = skipWhitespace(source, i);
    if (source[i] === "]") {
      return { value: items, end: i + 1 };
    }
    if (source[i] === ",") {
      i += 1;
      continue;
    }
    const item = parsePartialValue(source, i);
    if (!item) {
      break;
    }
    items.push(item.value);
    i = item.end;
  }

  return { value: items, end: source.length };
}

function parsePartialObject(source: string, start: number): ParseResult {
  const record: Record<string, unknown> = {};
  let i = start + 1;

  while (i < source.length) {
    i = skipWhitespace(source, i);
    if (source[i] === "}") {
      return { value: record, end: i + 1 };
    }
    if (source[i] === ",") {
      i += 1;
      continue;
    }
    if (source[i] !== '"') {
      break;
    }

    const key = parsePartialString(source, i);
    if (!key || key.end >= source.length) {
      // Key still streaming — nothing usable yet for this entry.
      break;
    }
    i = skipWhitespace(source, key.end);
    if (source[i] !== ":") {
      break;
    }
    i = skipWhitespace(source, i + 1);

    const value = parsePartialValue(source, i);
    if (!value) {
      break;
    }
    record[key.value as string] = value.value;
    i = value.end;
  }

  return { value: record, end: source.length };
}

function parsePartialValue(source: string, start: number): ParseResult {
  const i = skipWhitespace(source, start);
  const char = source[i];
  if (char === undefined) {
    return null;
  }
  if (char === '"') {
    return parsePartialString(source, i);
  }
  if (char === "{") {
    return parsePartialObject(source, i);
  }
  if (char === "[") {
    return parsePartialArray(source, i);
  }
  if (char === "-" || (char >= "0" && char <= "9")) {
    return parsePartialNumber(source, i);
  }
  return parsePartialLiteral(source, i);
}

/**
 * Best-effort parse of a potentially incomplete JSON document. Never
 * throws; returns undefined when nothing meaningful has streamed in yet.
 */
export function parsePartialJson(text: string | undefined): unknown {
  const trimmed = text?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to the tolerant parser.
  }

  const result = parsePartialValue(trimmed, 0);
  if (!result) {
    return undefined;
  }
  if (typeof result.value === "object" && result.value !== null) {
    const size = Array.isArray(result.value)
      ? result.value.length
      : Object.keys(result.value).length;
    return size > 0 ? result.value : undefined;
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Tool argument access
// ---------------------------------------------------------------------------

export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The renderer's view of a tool call's arguments: the parsed input once
 * execution starts, or a best-effort parse of the streaming argument text
 * before that. `streaming` is true while the args may still grow.
 */
export function getToolArgs(part: {
  input?: unknown;
  inputText?: string;
  state: string;
}): { args: Record<string, unknown>; streaming: boolean } {
  if (isPlainRecord(part.input)) {
    return { args: part.input, streaming: false };
  }
  const parsed = parsePartialJson(part.inputText);
  return {
    args: isPlainRecord(parsed) ? parsed : {},
    streaming: part.state === "input-streaming",
  };
}

// ---------------------------------------------------------------------------
// Tool output normalization
// ---------------------------------------------------------------------------

export type NormalizedToolOutput = {
  text?: string;
  details?: Record<string, unknown>;
};

function contentBlocksToText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .filter(
      (block): block is { type: string; text: string } =>
        isPlainRecord(block) &&
        block.type === "text" &&
        typeof block.text === "string"
    )
    .map((block) => block.text)
    .join("");
  return text.length > 0 ? text : undefined;
}

/**
 * Builds the wire/persistence shape of a tool output. Text and details
 * are kept separate so renderers get both (the old `details ?? text`
 * shape silently dropped the text whenever details existed).
 */
export function wrapToolOutput(
  text: string | undefined,
  details: unknown
): NormalizedToolOutput | undefined {
  const textValue = text && text.length > 0 ? text : undefined;
  const detailsValue = isPlainRecord(details) ? details : undefined;
  if (textValue === undefined && detailsValue === undefined) {
    return undefined;
  }
  return { text: textValue, details: detailsValue };
}

/**
 * Normalizes every historical shape of a tool part's `output` field into
 * `{ text, details }`:
 * - the current server shape `{ text, details }`
 * - the pre-fix server shape (bare `details` object, or bare text string)
 * - live `tool-update` previews (`{ content: [...], details }`)
 */
export function normalizeToolOutput(output: unknown): NormalizedToolOutput {
  if (output === undefined || output === null) {
    return {};
  }
  if (typeof output === "string") {
    return { text: output };
  }
  if (!isPlainRecord(output)) {
    return { text: JSON.stringify(output, null, 2) };
  }

  const keys = Object.keys(output);
  const isWrappedShape =
    keys.length > 0 && keys.every((key) => key === "text" || key === "details");
  if (isWrappedShape) {
    return {
      text: typeof output.text === "string" ? output.text : undefined,
      details: isPlainRecord(output.details) ? output.details : undefined,
    };
  }

  if ("content" in output) {
    return {
      text: contentBlocksToText(output.content),
      details: isPlainRecord(output.details) ? output.details : undefined,
    };
  }

  return { details: output };
}

// ---------------------------------------------------------------------------
// Edit tool helpers
// ---------------------------------------------------------------------------

export type EditReplacement = { oldText?: string; newText?: string };

/**
 * Extracts the edit list from (possibly partial) edit-tool arguments.
 * Handles the legacy top-level `oldText`/`newText` shape and `edits`
 * sent as a JSON string, mirroring the tool's own argument preparation.
 */
export function getEditReplacements(
  args: Record<string, unknown>
): EditReplacement[] {
  let rawEdits = args.edits;
  if (typeof rawEdits === "string") {
    rawEdits = parsePartialJson(rawEdits);
  }

  const edits: EditReplacement[] = [];
  if (Array.isArray(rawEdits)) {
    for (const entry of rawEdits) {
      if (isPlainRecord(entry)) {
        edits.push({
          oldText:
            typeof entry.oldText === "string" ? entry.oldText : undefined,
          newText:
            typeof entry.newText === "string" ? entry.newText : undefined,
        });
      }
    }
  }

  if (
    edits.length === 0 &&
    (typeof args.oldText === "string" || typeof args.newText === "string")
  ) {
    edits.push({
      oldText: typeof args.oldText === "string" ? args.oldText : undefined,
      newText: typeof args.newText === "string" ? args.newText : undefined,
    });
  }

  return edits;
}

export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let count = 1;
  for (const char of text) {
    if (char === "\n") {
      count += 1;
    }
  }
  return count;
}

/** Line counts for the provisional (streaming) diff view. */
export function provisionalEditStats(edits: EditReplacement[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (edit.oldText !== undefined) {
      removed += countLines(edit.oldText);
    }
    if (edit.newText !== undefined) {
      added += countLines(edit.newText);
    }
  }
  return { added, removed };
}

// ---------------------------------------------------------------------------
// Diff string parsing (pi edit tool format)
// ---------------------------------------------------------------------------

export type DiffLine = {
  kind: "add" | "del" | "ctx" | "gap";
  lineNumber?: number;
  text: string;
};

export type ParsedDiff = {
  lines: DiffLine[];
  added: number;
  removed: number;
};

/**
 * Parses the diff string produced by the pi edit tool
 * (`generateDiffString`): `+<n> text` / `-<n> text` / ` <n> text`, with
 * ` ... ` rows marking skipped context.
 */
export function parseEditDiff(diff: string): ParsedDiff {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const raw of diff.split("\n")) {
    if (raw.length === 0) {
      continue;
    }
    const sign = raw[0];
    const rest = raw.slice(1);
    const match = /^(\s*)(\d+) ?(.*)$/s.exec(rest);

    if (!match) {
      lines.push({ kind: "gap", text: "" });
      continue;
    }

    const lineNumber = Number(match[2]);
    const text = match[3];
    if (sign === "+") {
      added += 1;
      lines.push({ kind: "add", lineNumber, text });
    } else if (sign === "-") {
      removed += 1;
      lines.push({ kind: "del", lineNumber, text });
    } else {
      lines.push({ kind: "ctx", lineNumber, text });
    }
  }

  return { lines, added, removed };
}

/** Authoritative diff from an edit tool result, when present. */
export function getEditResultDiff(
  output: NormalizedToolOutput
): ParsedDiff | undefined {
  const diff = output.details?.diff;
  if (typeof diff !== "string" || diff.length === 0) {
    return undefined;
  }
  return parseEditDiff(diff);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Splits a path into a dimmed directory prefix and an emphasized name. */
export function splitPath(path: string): { dir: string; name: string } {
  const normalized = path.replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  if (separator === -1) {
    return { dir: "", name: normalized };
  }
  return {
    dir: normalized.slice(0, separator + 1),
    name: normalized.slice(separator + 1),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCharCount(characters: number): string {
  if (characters < 1000) {
    return `${characters} chars`;
  }
  return `${Math.round(characters / 1000)}k chars`;
}

/** `:12` or `:12–80` suffix for read calls with offset/limit. */
export function formatLineRange(
  offset: unknown,
  limit: unknown
): string | undefined {
  const start = typeof offset === "number" ? offset : undefined;
  const count = typeof limit === "number" ? limit : undefined;
  if (start === undefined && count === undefined) {
    return undefined;
  }
  const first = start ?? 1;
  if (count === undefined) {
    return `:${first}–`;
  }
  return `:${first}–${first + count - 1}`;
}

export function formatDuration(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

/** First line of a shell command, for the row subject. */
export function commandSummary(command: string): string {
  const firstLine = command.split("\n", 1)[0];
  return firstLine === command ? command : `${firstLine} …`;
}

// ---------------------------------------------------------------------------
// Tool name classification
// ---------------------------------------------------------------------------

const BUILTIN_TOOL_NAMES = new Set([
  "read",
  "edit",
  "write",
  "bash",
  "grep",
  "find",
  "ls",
  "fetch_webpage",
  "showcase_file",
]);

export function isBuiltinToolName(toolName: string): boolean {
  return BUILTIN_TOOL_NAMES.has(toolName);
}

/**
 * Server/tool identity for an MCP tool call. The adapter registers tools
 * as `<server>_<tool>` and returns `{ server, tool }` in result details;
 * details win when present, the name split is the streaming-time guess.
 */
export function getMcpIdentity(
  toolName: string,
  output: NormalizedToolOutput
): { server?: string; tool: string } {
  const server = output.details?.server;
  const tool = output.details?.tool;
  if (typeof server === "string" && typeof tool === "string") {
    return { server, tool };
  }

  const separator = toolName.indexOf("_");
  if (separator > 0 && separator < toolName.length - 1) {
    return {
      server: toolName.slice(0, separator),
      tool: toolName.slice(separator + 1),
    };
  }
  return { tool: toolName };
}

// ---------------------------------------------------------------------------
// fetch_webpage error classification
// ---------------------------------------------------------------------------

export type FetchErrorInfo = {
  /** Short chip label, e.g. "HTTP 404", "timeout", "reader 503". */
  chip: string;
  /** Human explanation for the row body. */
  message: string;
  hint?: string;
};

/**
 * Classifies a fetch_webpage error. The tool emits structured prefixes
 * ("HTTP 404 —", "timeout 30s —", "reader 503 —"); older persisted errors
 * fall back to prose matching.
 */
export function classifyFetchError(errorText: string): FetchErrorInfo {
  const structured = /^(HTTP|timeout|reader) ([^—]+)—\s*(.*)$/s.exec(errorText);
  if (structured) {
    const [, kind, detail, rest] = structured;
    const chip =
      kind === "HTTP"
        ? `HTTP ${detail.trim()}`
        : `${kind} ${detail.trim()}`.trim();
    return {
      chip,
      message: rest.trim() || errorText,
      hint:
        kind === "timeout"
          ? "Retry with a longer timeoutSeconds (up to 60)."
          : kind === "reader"
            ? "The reader proxy failed before reaching the site — usually transient."
            : undefined,
    };
  }

  const legacyStatus = /failed with (\d{3})/.exec(errorText);
  if (legacyStatus) {
    return { chip: `HTTP ${legacyStatus[1]}`, message: errorText };
  }
  if (/timed out/i.test(errorText)) {
    return {
      chip: "timeout",
      message: errorText,
      hint: "Retry with a longer timeoutSeconds (up to 60).",
    };
  }
  return { chip: "failed", message: errorText };
}
