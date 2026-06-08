import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureMcpConfigByUserId,
  getChatMcpServerOverrides,
  getMcpConfigByUserId,
  getProjectMcpServers,
} from "@/lib/db/queries";
import type { Chat } from "@/lib/db/schema";

export const MCP_CONFIG_FILE_NAME = "mcp.json";
export const MCP_CONFIG_DIR_NAME = ".pi";

export type McpCatalog = {
  settings?: Record<string, unknown>;
  mcpServers: Record<string, Record<string, unknown>>;
};

export type McpServerSummary = {
  id: string;
  transport: "stdio" | "http";
  label: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  serverId: string,
  server: Record<string, unknown>,
  field: string
) {
  const value = server[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`MCP server ${serverId}.${field} must be a string`);
  }
  return value;
}

function optionalBooleanField(
  serverId: string,
  server: Record<string, unknown>,
  field: string
) {
  const value = server[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`MCP server ${serverId}.${field} must be a boolean`);
  }
  return value;
}

function optionalNumberField(
  serverId: string,
  server: Record<string, unknown>,
  field: string
) {
  const value = server[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`MCP server ${serverId}.${field} must be a number`);
  }
  return value;
}

function scalarToString(
  serverId: string,
  field: string,
  value: unknown
): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  throw new Error(`MCP server ${serverId}.${field} values must be strings`);
}

function optionalStringArrayField(
  serverId: string,
  server: Record<string, unknown>,
  field: string
) {
  const value = server[field];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`MCP server ${serverId}.${field} must be an array`);
  }
  return value.map((entry) => scalarToString(serverId, field, entry));
}

function optionalStringRecordField(
  serverId: string,
  server: Record<string, unknown>,
  field: string
) {
  const value = server[field];
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new Error(`MCP server ${serverId}.${field} must be an object`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      scalarToString(serverId, field, entry),
    ])
  );
}

function optionalDirectToolsField(
  serverId: string,
  server: Record<string, unknown>
) {
  const value = server.directTools;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `MCP server ${serverId}.directTools must be a boolean or array`
    );
  }
  return value.map((entry) => scalarToString(serverId, "directTools", entry));
}

function assertServerEntry(
  serverId: string,
  value: unknown
): asserts value is Record<string, unknown> {
  if (!serverId.trim()) {
    throw new Error("MCP server ids cannot be empty");
  }

  if (!isPlainObject(value)) {
    throw new Error(`MCP server ${serverId} must be an object`);
  }

  const hasCommand = typeof value.command === "string" && value.command.trim();
  const hasUrl = typeof value.url === "string" && value.url.trim();

  if (!(hasCommand || hasUrl)) {
    throw new Error(`MCP server ${serverId} must define command or url`);
  }
}

function normalizeServerEntry(
  serverId: string,
  server: Record<string, unknown>
) {
  const lifecycle = server.lifecycle;
  if (
    lifecycle !== undefined &&
    lifecycle !== "keep-alive" &&
    lifecycle !== "lazy" &&
    lifecycle !== "eager"
  ) {
    throw new Error(
      `MCP server ${serverId}.lifecycle must be keep-alive, lazy, or eager`
    );
  }

  const auth = server.auth;
  if (
    auth !== undefined &&
    auth !== "oauth" &&
    auth !== "bearer" &&
    auth !== false
  ) {
    throw new Error(
      `MCP server ${serverId}.auth must be oauth, bearer, or false`
    );
  }

  const normalized: Record<string, unknown> = {
    ...server,
  };

  for (const field of [
    "command",
    "url",
    "cwd",
    "bearerToken",
    "bearerTokenEnv",
  ]) {
    const value = stringField(serverId, server, field);
    if (value !== undefined) {
      normalized[field] = value;
    }
  }

  const args = optionalStringArrayField(serverId, server, "args");
  if (args !== undefined) {
    normalized.args = args;
  }

  const env = optionalStringRecordField(serverId, server, "env");
  if (env !== undefined) {
    normalized.env = env;
  }

  const headers = optionalStringRecordField(serverId, server, "headers");
  if (headers !== undefined) {
    normalized.headers = headers;
  }

  const excludeTools = optionalStringArrayField(
    serverId,
    server,
    "excludeTools"
  );
  if (excludeTools !== undefined) {
    normalized.excludeTools = excludeTools;
  }

  const directTools = optionalDirectToolsField(serverId, server);
  if (directTools !== undefined) {
    normalized.directTools = directTools;
  }

  for (const field of ["idleTimeout"]) {
    const value = optionalNumberField(serverId, server, field);
    if (value !== undefined) {
      normalized[field] = value;
    }
  }

  for (const field of ["debug", "exposeResources"]) {
    const value = optionalBooleanField(serverId, server, field);
    if (value !== undefined) {
      normalized[field] = value;
    }
  }

  return normalized;
}

export function parseMcpCatalogText(json: string): McpCatalog {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON"
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error("MCP config must be a JSON object");
  }

  if (
    "settings" in parsed &&
    parsed.settings !== undefined &&
    !isPlainObject(parsed.settings)
  ) {
    throw new Error("MCP settings must be an object");
  }

  if (!isPlainObject(parsed.mcpServers)) {
    throw new Error("MCP config must include an mcpServers object");
  }

  const mcpServers: McpCatalog["mcpServers"] = {};
  for (const [serverId, server] of Object.entries(parsed.mcpServers)) {
    assertServerEntry(serverId, server);
    mcpServers[serverId] = normalizeServerEntry(serverId, server);
  }

  return {
    settings: isPlainObject(parsed.settings) ? parsed.settings : undefined,
    mcpServers,
  };
}

export function formatMcpCatalog(catalog: McpCatalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function summarizeMcpServers(catalog: McpCatalog): McpServerSummary[] {
  return Object.entries(catalog.mcpServers)
    .map(([id, server]) => ({
      id,
      transport:
        typeof server.url === "string" ? ("http" as const) : ("stdio" as const),
      label:
        typeof server.url === "string"
          ? server.url
          : [server.command, ...(Array.isArray(server.args) ? server.args : [])]
              .filter((value) => typeof value === "string")
              .join(" "),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function readUserMcpCatalog(userId: string) {
  const config =
    (await getMcpConfigByUserId({ userId })) ??
    (await ensureMcpConfigByUserId({ userId }));
  const catalog = parseMcpCatalogText(config.json);

  return {
    catalog,
    json: formatMcpCatalog(catalog),
    servers: summarizeMcpServers(catalog),
  };
}

function effectiveEnabledServerIds({
  chatOverrides,
  projectDefaults,
}: {
  chatOverrides: Array<{ serverId: string; state: string }>;
  projectDefaults: Array<{ serverId: string; enabled: boolean }>;
}) {
  const enabled = new Set(
    projectDefaults
      .filter((entry) => entry.enabled)
      .map((entry) => entry.serverId)
  );

  for (const override of chatOverrides) {
    if (override.state === "enabled") {
      enabled.add(override.serverId);
    } else if (override.state === "disabled") {
      enabled.delete(override.serverId);
    }
  }

  return enabled;
}

export async function getEffectiveMcpCatalogForChat(chat: Chat) {
  const { catalog } = await readUserMcpCatalog(chat.userId);
  const [projectDefaults, chatOverrides] = await Promise.all([
    chat.projectId ? getProjectMcpServers({ projectId: chat.projectId }) : [],
    getChatMcpServerOverrides({ chatId: chat.id }),
  ]);
  const enabled = effectiveEnabledServerIds({
    chatOverrides,
    projectDefaults,
  });
  const mcpServers: McpCatalog["mcpServers"] = {};

  for (const serverId of enabled) {
    const server = catalog.mcpServers[serverId];
    if (server) {
      mcpServers[serverId] = {
        ...server,
        directTools: false,
      };
    }
  }

  return {
    settings: {
      ...(catalog.settings ?? {}),
      directTools: false,
      disableProxyTool: false,
      elicitation: false,
      sampling: false,
    },
    mcpServers,
  } satisfies McpCatalog;
}

export async function writeMcpConfigForChat({
  chat,
  conversationPath,
}: {
  chat: Chat;
  conversationPath: string;
}) {
  const config = await getEffectiveMcpCatalogForChat(chat);
  const configDir = path.join(conversationPath, MCP_CONFIG_DIR_NAME);
  const configPath = path.join(configDir, MCP_CONFIG_FILE_NAME);

  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, formatMcpCatalog(config));

  return { config, configPath };
}
