import "server-only";

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderTokenStats } from "@/lib/types";
import { extractProviderStatsFromResponse } from "./provider-stats";

const INTERNAL_METADATA_DIR = ".pi-chatbot";
const CAPTURES_FILE_NAME = "provider-captures.jsonl";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "openai-api-key",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
  "x-openai-api-key",
]);

export type ProviderCapturePurpose = "chat" | "metadata";

export type ProviderCaptureRecord = {
  id: string;
  chatId: string;
  assistantMessageId: string;
  createdAt: string;
  completedAt?: string;
  purpose: ProviderCapturePurpose;
  provider: string;
  api: string;
  model: string;
  requestIndex: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    rawBody?: string;
    body?: unknown;
    bodyReadError?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    chunks?: string[];
    rawBody?: string;
    body?: unknown;
    bodyReadError?: string;
  };
  stats?: ProviderTokenStats;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
};

export type ProviderCaptureCounter = {
  value: number;
};

export type ProviderCaptureContext = {
  chatId: string;
  assistantMessageId: string;
  conversationPath: string;
  pendingWrites?: Set<Promise<void>>;
  purpose: ProviderCapturePurpose;
  requestCounter: ProviderCaptureCounter;
};

export function getProviderCapturesPath(conversationPath: string) {
  return path.join(conversationPath, INTERNAL_METADATA_DIR, CAPTURES_FILE_NAME);
}

export function sanitizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? "[redacted]" : value,
    ])
  );
}

export function headersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export function parseCapturedBody(rawBody: string | undefined) {
  if (rawBody === undefined || rawBody.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

export function serializeCaptureError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === "string" ? error : JSON.stringify(error, null, 2),
  };
}

function isProviderCaptureRecord(
  value: unknown
): value is ProviderCaptureRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ProviderCaptureRecord).id === "string" &&
    typeof (value as ProviderCaptureRecord).chatId === "string" &&
    typeof (value as ProviderCaptureRecord).requestIndex === "number" &&
    typeof (value as ProviderCaptureRecord).request === "object"
  );
}

export async function appendProviderCapture({
  conversationPath,
  record,
}: {
  conversationPath: string;
  record: ProviderCaptureRecord;
}) {
  const filePath = getProviderCapturesPath(conversationPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readProviderCaptures(conversationPath: string) {
  try {
    const raw = await readFile(
      getProviderCapturesPath(conversationPath),
      "utf8"
    );
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter(isProviderCaptureRecord)
      .map((record) => ({
        ...record,
        stats:
          record.stats ?? extractProviderStatsFromResponse(record.response),
      }));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
