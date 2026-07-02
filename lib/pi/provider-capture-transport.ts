import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isOpenAICompatibleRequest } from "@/lib/openai-compatible";
import {
  appendProviderCapture,
  headersToRecord,
  type ProviderCaptureContext,
  type ProviderCaptureRecord,
  parseCapturedBody,
  sanitizeHeaders,
  serializeCaptureError,
} from "./provider-captures";
import { extractProviderStatsFromResponse } from "./provider-stats";

type ProviderCaptureStore = ProviderCaptureContext & {
  api: string;
  model: string;
  provider: string;
};

const providerCaptureStorage = new AsyncLocalStorage<ProviderCaptureStore>();

let originalFetch: typeof fetch | null = null;
let fetchCaptureInstalled = false;

function getOriginalFetch() {
  if (!originalFetch) {
    originalFetch = globalThis.fetch.bind(globalThis);
  }
  return originalFetch;
}

function installProviderCaptureFetch() {
  if (fetchCaptureInstalled) {
    return;
  }

  const baseFetch = getOriginalFetch();
  globalThis.fetch = (input, init) => {
    const store = providerCaptureStorage.getStore();
    if (!store) {
      return baseFetch(input, init);
    }

    return captureProviderFetch(store, input, init, baseFetch);
  };

  fetchCaptureInstalled = true;
}

function trackProviderCaptureWrite(
  store: ProviderCaptureStore,
  write: Promise<void>
) {
  if (!store.pendingWrites) {
    return;
  }

  store.pendingWrites.add(write);
  write
    .finally(() => {
      store.pendingWrites?.delete(write);
    })
    .catch(() => undefined);
}

function decodeChunk(decoder: TextDecoder, chunk: Uint8Array) {
  return decoder.decode(chunk, { stream: true });
}

async function readBodyText(request: Request) {
  try {
    return { rawBody: await request.clone().text() };
  } catch (error) {
    return { bodyReadError: serializeCaptureError(error).message };
  }
}

async function readResponseBody(response: Response) {
  const chunks: string[] = [];
  const reader = response.body?.getReader();

  if (!reader) {
    const rawBody = await response.text();
    return {
      chunks,
      rawBody,
      body: parseCapturedBody(rawBody),
    };
  }

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(decodeChunk(decoder, value));
    }
  }

  const tail = decoder.decode();
  if (tail) {
    chunks.push(tail);
  }

  const rawBody = chunks.join("");
  return {
    chunks,
    rawBody,
    body: parseCapturedBody(rawBody),
  };
}

async function finalizeResponseCapture({
  conversationPath,
  record,
  response,
}: {
  conversationPath: string;
  record: ProviderCaptureRecord;
  response: Response;
}) {
  try {
    const responseBody = await readResponseBody(response);
    const capturedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeHeaders(headersToRecord(response.headers)),
      ...responseBody,
    };
    await appendProviderCapture({
      conversationPath,
      record: {
        ...record,
        completedAt: new Date().toISOString(),
        response: capturedResponse,
        stats: extractProviderStatsFromResponse(capturedResponse),
      },
    });
  } catch (error) {
    await appendProviderCapture({
      conversationPath,
      record: {
        ...record,
        completedAt: new Date().toISOString(),
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: sanitizeHeaders(headersToRecord(response.headers)),
          bodyReadError: serializeCaptureError(error).message,
        },
      },
    });
  }
}

async function captureProviderFetch(
  store: ProviderCaptureStore,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  baseFetch: typeof fetch
) {
  const request = new Request(input, init);
  const { rawBody, bodyReadError } = await readBodyText(request);
  const body = parseCapturedBody(rawBody);

  if (
    !isOpenAICompatibleRequest({
      api: store.api,
      body,
      bodyReadError,
      method: request.method,
      url: request.url,
    })
  ) {
    return baseFetch(request);
  }

  const createdAt = new Date().toISOString();
  store.requestCounter.value += 1;
  const requestIndex = store.requestCounter.value;
  const headers = sanitizeHeaders(headersToRecord(request.headers));

  const record: ProviderCaptureRecord = {
    id: randomUUID(),
    chatId: store.chatId,
    assistantMessageId: store.assistantMessageId,
    createdAt,
    purpose: store.purpose,
    provider: store.provider,
    api: store.api,
    model: store.model,
    requestIndex,
    request: {
      method: request.method,
      url: request.url,
      headers,
      rawBody,
      body,
      bodyReadError,
    },
  };

  try {
    const response = await baseFetch(request);
    const write = finalizeResponseCapture({
      conversationPath: store.conversationPath,
      record,
      response: response.clone(),
    }).catch((error) => {
      console.warn("Failed to write provider capture", error);
    });
    trackProviderCaptureWrite(store, write);
    return response;
  } catch (error) {
    await appendProviderCapture({
      conversationPath: store.conversationPath,
      record: {
        ...record,
        completedAt: new Date().toISOString(),
        error: serializeCaptureError(error),
      },
    });
    throw error;
  }
}

export function runWithProviderCapture<T>(
  context: ProviderCaptureContext,
  provider: {
    api: string;
    model: string;
    provider: string;
  },
  fn: () => T
) {
  installProviderCaptureFetch();
  return providerCaptureStorage.run({ ...context, ...provider }, fn);
}

export async function waitForProviderCaptureWrites(
  pendingWrites: Set<Promise<void>>
) {
  while (pendingWrites.size > 0) {
    await Promise.allSettled(Array.from(pendingWrites));
  }
}
