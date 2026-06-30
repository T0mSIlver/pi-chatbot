import { expect, test } from "@playwright/test";
import {
  addMcpServerToCatalog,
  buildMcpServerEntry,
  parseMcpCommandText,
  redactMcpMessage,
} from "../../lib/pi/mcp-catalog";

test("parses command MCP servers with inline and explicit env vars", () => {
  const parsed = parseMcpCommandText(
    'API_KEY=$API_KEY npx -y "some mcp server" --flag'
  );

  expect(parsed).toEqual({
    args: ["-y", "some mcp server", "--flag"],
    command: "npx",
    env: { API_KEY: "$API_KEY" },
  });

  expect(
    buildMcpServerEntry({
      command: "TOKEN=inline node ./server.js",
      env: { TOKEN: "explicit", WORKSPACE: "/tmp/project" },
      id: "local-server",
      mode: "command",
    })
  ).toMatchObject({
    args: ["./server.js"],
    command: "node",
    env: { TOKEN: "explicit", WORKSPACE: "/tmp/project" },
    lifecycle: "lazy",
  });

  expect(
    buildMcpServerEntry({
      command: "TOKEN=$TOKEN node ./server.js",
      id: "env-server",
      mode: "command",
    })
  ).toMatchObject({
    env: { TOKEN: "${TOKEN}" },
  });
});

test("builds URL MCP servers and rejects duplicate ids", () => {
  const entry = buildMcpServerEntry({
    auth: "bearer",
    bearerTokenEnv: "MCP_TOKEN",
    headers: { "X-Workspace": "local" },
    id: "remote",
    lifecycle: "eager",
    mode: "url",
    url: "https://example.com/mcp",
  });

  expect(entry).toEqual({
    auth: "bearer",
    bearerTokenEnv: "MCP_TOKEN",
    headers: { "X-Workspace": "local" },
    lifecycle: "eager",
    url: "https://example.com/mcp",
  });

  expect(() =>
    addMcpServerToCatalog({
      catalog: { mcpServers: { remote: entry } },
      entry,
      id: "remote",
    })
  ).toThrow(/already exists/);
});

test("redacts likely secrets from MCP probe messages", () => {
  expect(
    redactMcpMessage(
      "request failed with bearer abc123 and token=secret-value",
      {
        env: { API_KEY: "secret-value" },
        headers: { Authorization: "bearer abc123" },
      }
    )
  ).toBe("request failed with bearer [redacted] and token=[redacted]");
});
