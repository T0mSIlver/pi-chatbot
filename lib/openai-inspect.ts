import type { ProviderCaptureRecord } from "@/lib/pi/provider-captures";

/**
 * Client-safe parsing helpers for the OpenAI payload inspector. These turn the
 * raw capture records (OpenAI Chat Completions requests + streamed/JSON
 * responses) into structured shapes the UI can render without ever exposing a
 * raw JSON blob to the user.
 */

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } }
  | { type: string; [key: string]: unknown };

export type OpenAIToolCall = {
  id?: string;
  index?: number;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export type OpenAIMessage = {
  role: string;
  content?: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
  [key: string]: unknown;
};

export type CapturedError = NonNullable<ProviderCaptureRecord["error"]>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type ParsedRequest = {
  meta: { method: string; url: string; headers: Record<string, string> };
  messages: OpenAIMessage[];
  tools: unknown[];
  params: Record<string, unknown>;
  rawText?: string;
  bodyReadError?: string;
};

// Fields rendered in the dedicated messages / tools sections so they aren't
// repeated in the generic parameter grid.
const REQUEST_SECTIONED_KEYS = new Set(["messages", "tools"]);

export function parseInspectorRequest(
  capture: ProviderCaptureRecord
): ParsedRequest {
  const { request } = capture;
  const meta = {
    method: request.method,
    url: request.url,
    headers: request.headers ?? {},
  };

  const body = request.body;
  const record = asRecord(body);

  if (!record) {
    return {
      meta,
      messages: [],
      tools: [],
      params: {},
      rawText: asString(body) ?? request.rawBody,
      bodyReadError: request.bodyReadError,
    };
  }

  const messages = (asArray(record.messages) ?? []).filter(
    (entry): entry is OpenAIMessage => asRecord(entry) !== undefined
  );
  const tools = asArray(record.tools) ?? [];
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!REQUEST_SECTIONED_KEYS.has(key)) {
      params[key] = value;
    }
  }

  return {
    meta,
    messages,
    tools,
    params,
    bodyReadError: request.bodyReadError,
  };
}

export function normalizeContentParts(
  content: OpenAIMessage["content"]
): OpenAIContentPart[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content.filter(
      (part): part is OpenAIContentPart => asRecord(part) !== undefined
    );
  }
  return [];
}

export function toolCallArguments(toolCall: OpenAIToolCall): {
  text: string;
  parsed?: unknown;
} {
  const text = toolCall.function?.arguments ?? "";
  if (text.length === 0) {
    return { text };
  }
  try {
    return { text, parsed: JSON.parse(text) };
  } catch {
    return { text };
  }
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type StreamEvent = {
  index: number;
  raw: string;
  role?: string;
  content?: string;
  reasoning?: string;
  toolCalls?: OpenAIToolCall[];
  finishReason?: string;
  usage?: unknown;
  // In-band error payloads (e.g. `data: {"error":{...}}`) that some providers
  // emit mid-stream on a 200 response.
  error?: unknown;
  // Parsed JSON for events that carry no field we recognize, so the UI can
  // render the shape instead of a blank row.
  data?: unknown;
  isDone: boolean;
  parseError?: boolean;
};

export type CollectedContent = {
  role?: string;
  text: string;
  reasoning: string;
  toolCalls: { id?: string; name?: string; arguments: string }[];
  finishReason?: string;
  usage?: unknown;
  error?: unknown;
};

export type ResponseMeta = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
};

export type ParsedResponse =
  | { kind: "pending" }
  | { kind: "network-error"; error: CapturedError }
  | ({ kind: "body-error"; bodyReadError: string } & ResponseMeta)
  | ({
      kind: "stream";
      events: StreamEvent[];
      collected: CollectedContent;
    } & ResponseMeta)
  | ({
      kind: "message";
      message?: OpenAIMessage;
      finishReason?: string;
      usage?: unknown;
    } & ResponseMeta)
  | ({ kind: "error-body"; error: unknown } & ResponseMeta)
  | ({ kind: "other"; value?: unknown; text?: string } & ResponseMeta);

function looksLikeSse(
  rawBody: string,
  headers: Record<string, string>
): boolean {
  const contentType = headers["content-type"] ?? headers["Content-Type"] ?? "";
  if (contentType.includes("event-stream")) {
    return true;
  }
  return /^data:/m.test(rawBody);
}

/**
 * Splits an SSE body into the raw payloads carried by its `data:` lines. Shared
 * with the provider-stats extractor so the wire-format parsing lives in one
 * place.
 */
export function splitSsePayloads(rawBody: string): string[] {
  return rawBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""));
}

function parseStreamEvent(payload: string, index: number): StreamEvent {
  if (payload === "[DONE]") {
    return { index, raw: payload, isDone: true };
  }

  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { index, raw: payload, isDone: false, parseError: true };
  }

  const root = asRecord(json) ?? {};
  const choice = asRecord(asArray(root.choices)?.[0]);
  const delta = asRecord(choice?.delta);

  const event: StreamEvent = {
    index,
    raw: payload,
    isDone: false,
    role: asString(delta?.role),
    content: asString(delta?.content),
    reasoning: asString(delta?.reasoning_content) ?? asString(delta?.reasoning),
    toolCalls: asArray(delta?.tool_calls) as OpenAIToolCall[] | undefined,
    finishReason: asString(choice?.finish_reason),
    usage: root.usage,
    error: root.error,
  };

  // Providers can stream an error chunk or an unexpected shape on an otherwise
  // 200 response. Keep the parsed JSON so the UI renders it instead of a blank
  // row that wrongly reads as "no content".
  const hasKnownField =
    event.role !== undefined ||
    event.content !== undefined ||
    event.reasoning !== undefined ||
    (event.toolCalls?.length ?? 0) > 0 ||
    event.finishReason !== undefined ||
    event.usage !== undefined ||
    event.error !== undefined;
  if (!hasKnownField) {
    event.data = json;
  }

  return event;
}

function collectStreamEvents(events: StreamEvent[]): CollectedContent {
  const collected: CollectedContent = {
    text: "",
    reasoning: "",
    toolCalls: [],
  };

  for (const event of events) {
    if (event.role && !collected.role) {
      collected.role = event.role;
    }
    if (event.content) {
      collected.text += event.content;
    }
    if (event.reasoning) {
      collected.reasoning += event.reasoning;
    }
    if (event.finishReason) {
      collected.finishReason = event.finishReason;
    }
    if (event.usage !== undefined) {
      collected.usage = event.usage;
    }
    if (event.error !== undefined && collected.error === undefined) {
      collected.error = event.error;
    }
    if (event.toolCalls) {
      const eventToolCalls: OpenAIToolCall[] = event.toolCalls;
      for (const [i, toolCall] of eventToolCalls.entries()) {
        const slot = toolCall.index ?? i;
        const existing = collected.toolCalls[slot] ?? { arguments: "" };
        collected.toolCalls[slot] = {
          id: toolCall.id ?? existing.id,
          name: toolCall.function?.name ?? existing.name,
          arguments: existing.arguments + (toolCall.function?.arguments ?? ""),
        };
      }
    }
  }

  // Drop empty holes left by sparse tool-call indexes.
  collected.toolCalls = collected.toolCalls.filter(Boolean);
  return collected;
}

export function parseInspectorResponse(
  capture: ProviderCaptureRecord
): ParsedResponse {
  if (capture.error) {
    return { kind: "network-error", error: capture.error };
  }

  const { response } = capture;
  if (!response) {
    return { kind: "pending" };
  }

  const meta: ResponseMeta = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers ?? {},
  };

  if (response.bodyReadError) {
    return {
      kind: "body-error",
      bodyReadError: response.bodyReadError,
      ...meta,
    };
  }

  const rawBody = response.rawBody ?? response.chunks?.join("") ?? "";

  if (rawBody && looksLikeSse(rawBody, meta.headers)) {
    const events = splitSsePayloads(rawBody).map((payload, index) =>
      parseStreamEvent(payload, index)
    );
    return {
      kind: "stream",
      events,
      collected: collectStreamEvents(events),
      ...meta,
    };
  }

  const bodyRecord = asRecord(response.body);

  if (bodyRecord) {
    // Treat the body as an error only when there is an actual error to show: a
    // 4xx/5xx status, or a non-null `error` field. Some providers include an
    // explicit `"error": null` on a successful 200 body, which must still render
    // as a normal message.
    const hasErrorField =
      bodyRecord.error !== undefined && bodyRecord.error !== null;
    if (meta.status >= 400 || hasErrorField) {
      return {
        kind: "error-body",
        error: bodyRecord.error ?? bodyRecord,
        ...meta,
      };
    }

    const choice = asRecord(asArray(bodyRecord.choices)?.[0]);
    if (choice) {
      const message = asRecord(choice.message) as OpenAIMessage | undefined;
      return {
        kind: "message",
        message,
        finishReason: asString(choice.finish_reason),
        usage: bodyRecord.usage,
        ...meta,
      };
    }

    return { kind: "other", value: bodyRecord, ...meta };
  }

  if (rawBody) {
    return { kind: "other", text: rawBody, ...meta };
  }

  return { kind: "other", ...meta };
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

export function collectedToText(collected: CollectedContent): string {
  const segments: string[] = [];
  if (collected.reasoning) {
    segments.push(`# Reasoning\n${collected.reasoning}`);
  }
  if (collected.text) {
    segments.push(collected.text);
  }
  for (const call of collected.toolCalls) {
    segments.push(
      `# Tool call: ${call.name ?? "(unnamed)"}\n${call.arguments}`
    );
  }
  return segments.join("\n\n");
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export type CopyContext = {
  tab: "request" | "response";
  responseMode: "stream" | "collected";
};

/**
 * Builds the text the copy button puts on the clipboard. Copy is an export
 * affordance, so it favours the most useful machine-readable form for the
 * active view rather than mirroring the (deliberately non-raw) display.
 */
export function buildCopyPayload(
  capture: ProviderCaptureRecord,
  context: CopyContext,
  parsedResponse?: ParsedResponse
): string {
  if (context.tab === "request") {
    return stableStringify(capture.request.body ?? capture.request);
  }

  const parsed = parsedResponse ?? parseInspectorResponse(capture);
  if (parsed.kind === "stream") {
    if (context.responseMode === "collected") {
      const text = collectedToText(parsed.collected);
      return text.length > 0 ? text : stableStringify(parsed.collected);
    }
    return parsed.events.map((event) => `data: ${event.raw}`).join("\n");
  }

  return stableStringify(capture.response ?? capture.error ?? null);
}
