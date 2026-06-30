import "server-only";

import { homedir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { redactMcpMessage } from "./mcp-catalog";

export type McpConnectionState =
  | "checking"
  | "connected"
  | "needs-auth"
  | "timeout"
  | "error"
  | "not-tested";

export type McpProbeResult = {
  checkedAt: string;
  connectionState: Exclude<McpConnectionState, "checking">;
  latencyMs?: number;
  message?: string;
};

const PROBE_TIMEOUT_MS = 4000;

function resolveTemplateValue(value: string) {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (
      _match,
      braced: string | undefined,
      prefixed: string | undefined,
      bare: string | undefined
    ) => process.env[braced ?? prefixed ?? bare ?? ""] ?? ""
  );
}

function resolveRecord(record?: Record<string, unknown>) {
  if (!record) {
    return undefined;
  }

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      resolved[key] = resolveTemplateValue(value);
    }
  }

  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function resolveProcessEnv(serverEnv?: Record<string, unknown>) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ...(resolveRecord(serverEnv) ?? {}),
  };
}

function resolvePathValue(value?: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const resolved = resolveTemplateValue(value.trim());
  if (resolved === "~") {
    return homedir();
  }
  if (resolved.startsWith("~/")) {
    return path.join(homedir(), resolved.slice(2));
  }
  return resolved;
}

function bearerTokenForServer(server: Record<string, unknown>) {
  if (typeof server.bearerToken === "string") {
    return resolveTemplateValue(server.bearerToken);
  }

  if (typeof server.bearerTokenEnv === "string") {
    return process.env[server.bearerTokenEnv];
  }

  return undefined;
}

function createHttpTransport({
  server,
  transport,
}: {
  server: Record<string, unknown>;
  transport: "streamable" | "sse";
}) {
  const url = new URL(String(server.url));
  let headers = resolveRecord(server.headers as Record<string, unknown>);

  if (server.auth === "bearer") {
    const token = bearerTokenForServer(server);
    if (token) {
      headers = {
        ...(headers ?? {}),
        Authorization: `Bearer ${token}`,
      };
    }
  }

  const requestInit = headers ? { headers } : undefined;

  return transport === "streamable"
    ? new StreamableHTTPClientTransport(url, { requestInit })
    : new SSEClientTransport(url, { requestInit });
}

function createStdioTransport(server: Record<string, unknown>) {
  const command = String(server.command ?? "").trim();

  if (!command) {
    throw new Error("Server has no command");
  }

  return new StdioClientTransport({
    args: Array.isArray(server.args)
      ? server.args.filter((arg): arg is string => typeof arg === "string")
      : [],
    command,
    cwd: resolvePathValue(server.cwd),
    env: resolveProcessEnv(server.env as Record<string, unknown> | undefined),
    stderr: "ignore",
  });
}

function isTimeoutError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }

  if (error instanceof Error) {
    return /abort|timed out|timeout/i.test(error.message);
  }

  return false;
}

function probeErrorResult({
  error,
  server,
  startedAt,
}: {
  error: unknown;
  server: Record<string, unknown>;
  startedAt: number;
}): McpProbeResult {
  const base = {
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
  };

  if (error instanceof UnauthorizedError) {
    return {
      ...base,
      connectionState: "needs-auth",
      message: "Authentication is required.",
    };
  }

  if (isTimeoutError(error)) {
    return {
      ...base,
      connectionState: "timeout",
      message: "MCP server did not respond to ping in time.",
    };
  }

  return {
    ...base,
    connectionState: "error",
    message: redactMcpMessage(
      error instanceof Error ? error.message : "Connection failed",
      server
    ),
  };
}

async function probeWithTransport({
  server,
  startedAt,
  transport,
}: {
  server: Record<string, unknown>;
  startedAt: number;
  transport: Transport;
}): Promise<McpProbeResult> {
  const client = new Client({
    name: "pi-chatbot-mcp-probe",
    version: "1.0.0",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("MCP probe timed out", "TimeoutError"));
  }, PROBE_TIMEOUT_MS);

  try {
    await client.connect(transport, {
      signal: controller.signal,
      timeout: PROBE_TIMEOUT_MS,
    });
    await client.ping({
      signal: controller.signal,
      timeout: PROBE_TIMEOUT_MS,
    });

    return {
      checkedAt: new Date().toISOString(),
      connectionState: "connected",
      latencyMs: Date.now() - startedAt,
      message: "Ping succeeded.",
    };
  } catch (error) {
    return probeErrorResult({ error, server, startedAt });
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

export async function probeMcpServer({
  server,
}: {
  server: Record<string, unknown>;
}): Promise<McpProbeResult> {
  const startedAt = Date.now();

  if (typeof server.url === "string") {
    const streamable = await probeWithTransport({
      server,
      startedAt,
      transport: createHttpTransport({ server, transport: "streamable" }),
    });

    if (
      streamable.connectionState === "connected" ||
      streamable.connectionState === "needs-auth"
    ) {
      return streamable;
    }

    const sse = await probeWithTransport({
      server,
      startedAt,
      transport: createHttpTransport({ server, transport: "sse" }),
    });

    return sse.connectionState === "connected" ||
      sse.connectionState === "needs-auth"
      ? sse
      : streamable;
  }

  return probeWithTransport({
    server,
    startedAt,
    transport: createStdioTransport(server),
  });
}
