import type { ProviderCaptureRecord } from "@/lib/pi/provider-captures";

type OpenAICompatibleRequest = {
  api?: string;
  body?: unknown;
  bodyReadError?: string;
  method?: string;
  url?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isChatCompletionsUrl(value: string | undefined) {
  if (!value) {
    return false;
  }

  try {
    const pathname = new URL(value).pathname.replace(/\/+$/, "");
    return pathname.endsWith("/chat/completions");
  } catch {
    return /\/chat\/completions\/?(?:[?#]|$)/.test(value);
  }
}

function parseJsonBody(rawBody: string | undefined) {
  if (!rawBody) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return rawBody;
  }
}

function numericRequestIndex(capture: ProviderCaptureRecord) {
  const parsed = Number(capture.requestIndex);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export function isOpenAICompatibleRequest({
  api,
  body,
  bodyReadError,
  method,
  url,
}: OpenAICompatibleRequest) {
  if (
    api !== "openai-completions" ||
    method?.toUpperCase() !== "POST" ||
    !isChatCompletionsUrl(url)
  ) {
    return false;
  }

  if (bodyReadError) {
    return true;
  }

  const record = asRecord(body);
  return typeof record?.model === "string" && Array.isArray(record.messages);
}

export function isOpenAICompatibleCapture(capture: ProviderCaptureRecord) {
  return isOpenAICompatibleRequest({
    api: capture.api,
    body: capture.request.body ?? parseJsonBody(capture.request.rawBody),
    bodyReadError: capture.request.bodyReadError,
    method: capture.request.method,
    url: capture.request.url,
  });
}

export function compareProviderCaptures(
  first: ProviderCaptureRecord,
  second: ProviderCaptureRecord
) {
  const indexDelta =
    numericRequestIndex(first) - numericRequestIndex(second);
  if (indexDelta !== 0) {
    return indexDelta;
  }

  const timeDelta = timestamp(first.createdAt) - timestamp(second.createdAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return first.id.localeCompare(second.id);
}
