export type McpCatalogData = {
  settings?: Record<string, unknown>;
  mcpServers: Record<string, Record<string, unknown>>;
};

export type McpLifecycle = "lazy" | "eager" | "keep-alive";

export type AddMcpServerInput =
  | {
      mode: "command";
      id: string;
      command: string;
      cwd?: string;
      env?: Record<string, string>;
      lifecycle?: McpLifecycle;
    }
  | {
      mode: "url";
      id: string;
      url: string;
      auth?: "none" | "bearer" | "oauth";
      bearerTokenEnv?: string;
      headers?: Record<string, string>;
      lifecycle?: McpLifecycle;
    };

const SERVER_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const ENV_ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const SIMPLE_ENV_REFERENCE_PATTERN = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const SECRET_VALUE_PATTERN =
  /(bearer\s+)[^\s,;]+|((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi;

function compactStringRecord(record?: Record<string, string>) {
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0);

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeEnvRecord(record?: Record<string, string>) {
  const compacted = compactStringRecord(record);
  if (!compacted) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(compacted).map(([key, value]) => {
      const match = SIMPLE_ENV_REFERENCE_PATTERN.exec(value);
      return [key, match ? `\${${match[1]}}` : value];
    })
  );
}

export function normalizeMcpServerId(id: string) {
  const normalized = id.trim();

  if (!normalized) {
    throw new Error("MCP server id is required");
  }

  if (!SERVER_ID_PATTERN.test(normalized)) {
    throw new Error(
      "MCP server ids can only include letters, numbers, dots, dashes, and underscores"
    );
  }

  return normalized;
}

export function splitMcpCommandLine(commandText: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of commandText.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    throw new Error("Command has an unterminated quote");
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

export function parseMcpCommandText(commandText: string) {
  const tokens = splitMcpCommandLine(commandText);
  const env: Record<string, string> = {};

  while (tokens.length > 0) {
    const match = ENV_ASSIGNMENT_PATTERN.exec(tokens[0]);
    if (!match) {
      break;
    }

    env[match[1]] = match[2];
    tokens.shift();
  }

  const [command, ...args] = tokens;

  if (!command) {
    throw new Error("Command MCP servers must include an executable");
  }

  return {
    command,
    args,
    env: Object.keys(env).length > 0 ? env : undefined,
  };
}

export function buildMcpServerEntry(input: AddMcpServerInput) {
  normalizeMcpServerId(input.id);

  if (input.mode === "command") {
    const parsed = parseMcpCommandText(input.command);
    const env = normalizeEnvRecord({
      ...(parsed.env ?? {}),
      ...(input.env ?? {}),
    });
    const entry: Record<string, unknown> = {
      command: parsed.command,
      lifecycle: input.lifecycle ?? "lazy",
    };

    if (parsed.args.length > 0) {
      entry.args = parsed.args;
    }
    if (input.cwd?.trim()) {
      entry.cwd = input.cwd.trim();
    }
    if (env) {
      entry.env = env;
    }

    return entry;
  }

  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new Error("URL MCP servers must include a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL MCP servers must use http or https");
  }

  const headers = compactStringRecord(input.headers);
  const entry: Record<string, unknown> = {
    lifecycle: input.lifecycle ?? "lazy",
    url: url.toString(),
  };

  if (headers) {
    entry.headers = headers;
  }

  if (input.auth === "bearer") {
    if (!input.bearerTokenEnv?.trim()) {
      throw new Error("Bearer auth requires an environment variable name");
    }
    entry.auth = "bearer";
    entry.bearerTokenEnv = input.bearerTokenEnv.trim();
  } else if (input.auth === "oauth") {
    entry.auth = "oauth";
  }

  return entry;
}

export function addMcpServerToCatalog({
  catalog,
  entry,
  id,
}: {
  catalog: McpCatalogData;
  entry: Record<string, unknown>;
  id: string;
}) {
  const normalizedId = normalizeMcpServerId(id);

  if (catalog.mcpServers[normalizedId]) {
    throw new Error(`MCP server "${normalizedId}" already exists`);
  }

  return {
    settings: catalog.settings,
    mcpServers: {
      ...catalog.mcpServers,
      [normalizedId]: entry,
    },
  } satisfies McpCatalogData;
}

export function redactMcpMessage(
  message: string,
  server?: Record<string, unknown>
) {
  let redacted = message.replace(SECRET_VALUE_PATTERN, (_match, bearer, named) =>
    `${bearer ?? named}[redacted]`
  );

  for (const value of Object.values({
    ...(server?.env as Record<string, unknown> | undefined),
    ...(server?.headers as Record<string, unknown> | undefined),
  })) {
    if (typeof value === "string" && value.length >= 4) {
      redacted = redacted.split(value).join("[redacted]");
    }
  }

  if (typeof server?.bearerToken === "string" && server.bearerToken.length >= 4) {
    redacted = redacted.split(server.bearerToken).join("[redacted]");
  }

  return redacted.slice(0, 240);
}
