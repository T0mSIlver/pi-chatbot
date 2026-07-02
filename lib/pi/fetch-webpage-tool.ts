import "server-only";

import { isIP } from "node:net";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_READER_BASE_URL = "https://r.jina.ai";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARACTERS = 30_000;
const MAX_MAX_CHARACTERS = 80_000;

function isPrivateAddress(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (host === "localhost") {
    return true;
  }

  const ipVersion = isIP(host);

  if (ipVersion === 4) {
    const [first, second] = host.split(".").map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (ipVersion === 6) {
    return (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    );
  }

  return false;
}

function normalizeUrl(rawUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Expected a valid absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not supported.");
  }

  if (isPrivateAddress(parsed.hostname)) {
    throw new Error("Only public URLs are supported.");
  }

  return parsed.toString();
}

function getReaderBaseUrl() {
  const configured = process.env.JINA_READER_BASE_URL?.trim();
  const baseUrl = configured || DEFAULT_READER_BASE_URL;
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function clampMaxCharacters(value: number | undefined) {
  if (value === undefined) {
    return DEFAULT_MAX_CHARACTERS;
  }

  return Math.min(Math.max(value, 1000), MAX_MAX_CHARACTERS);
}

function getTimeoutMs(timeoutSeconds: number | undefined) {
  if (timeoutSeconds === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.max(timeoutSeconds, 5), 60) * 1000;
}

function truncateMarkdown(markdown: string, maxCharacters: number) {
  if (markdown.length <= maxCharacters) {
    return {
      markdown,
      truncated: false,
    };
  }

  return {
    markdown: `${markdown.slice(0, maxCharacters)}\n\n[truncated after ${maxCharacters} characters]`,
    truncated: true,
  };
}

async function fetchWithTimeout({
  url,
  headers,
  timeoutMs,
  signal,
}: {
  url: string;
  headers: HeadersInit;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    return await fetch(url, {
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (!timedOut) {
        throw new Error("fetch_webpage was aborted.");
      }

      throw new Error(`Jina Reader timed out after ${timeoutMs / 1000}s.`);
    }

    throw error;
  } finally {
    signal?.removeEventListener("abort", abortFromParent);
    clearTimeout(timeout);
  }
}

export function createFetchWebpageTool(): ToolDefinition {
  return defineTool({
    name: "fetch_webpage",
    label: "fetch webpage",
    description:
      "Fetch a public webpage through Jina Reader and return clean Markdown content.",
    promptSnippet: "Fetch a public webpage and return it as Markdown",
    promptGuidelines: [
      "Use fetch_webpage when the user provides a URL and asks to read, summarize, inspect, or cite the page content.",
      "Use fetch_webpage after web search when a result snippet is not enough and you need the page body.",
      "This tool only reads public http/https URLs. It cannot access pages that require login.",
    ],
    parameters: Type.Object({
      url: Type.String({
        description: "Absolute public http or https URL to fetch.",
      }),
      maxCharacters: Type.Optional(
        Type.Integer({
          description:
            "Maximum markdown characters to return. Defaults to 30000; maximum 80000.",
          minimum: 1000,
          maximum: MAX_MAX_CHARACTERS,
        })
      ),
      timeoutSeconds: Type.Optional(
        Type.Integer({
          description:
            "Request timeout in seconds. Defaults to 30; maximum 60.",
          minimum: 5,
          maximum: 60,
        })
      ),
      fresh: Type.Optional(
        Type.Boolean({
          description:
            "Bypass Jina Reader cache when fresh page content matters. Defaults to false.",
        })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const targetUrl = normalizeUrl(params.url);
      const maxCharacters = clampMaxCharacters(params.maxCharacters);
      const timeoutMs = getTimeoutMs(params.timeoutSeconds);
      const readerUrl = `${getReaderBaseUrl()}/${targetUrl}`;
      const headers: Record<string, string> = {
        Accept: "text/plain",
        "X-Respond-With": "frontmatter",
      };

      if (params.fresh) {
        headers["X-No-Cache"] = "true";
      }

      if (process.env.JINA_API_KEY) {
        headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
      }

      const response = await fetchWithTimeout({
        url: readerUrl,
        headers,
        timeoutMs,
        signal,
      });
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Jina Reader failed with ${response.status} ${response.statusText}: ${responseText.slice(0, 500)}`
        );
      }

      const { markdown, truncated } = truncateMarkdown(
        responseText,
        maxCharacters
      );

      return {
        content: [
          {
            type: "text",
            text: markdown,
          },
        ],
        details: {
          url: targetUrl,
          readerUrl,
          provider: "jina-reader",
          truncated,
          maxCharacters,
        },
      };
    },
  });
}
