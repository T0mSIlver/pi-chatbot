import "server-only";

import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Chat } from "@/lib/db/schema";
import { createFetchWebpageTool } from "./fetch-webpage-tool";
import { writeMcpConfigForChat } from "./mcp-config";
import { createPiModelRegistry, findPiModel } from "./model";
import { withProviderCaptureModel } from "./provider-capture-provider";
import type { ProviderCaptureContext } from "./provider-captures";
import { createShowcaseFileTool } from "./showcase-tool";

let mcpAdapterEnvironmentQueue = Promise.resolve();

/**
 * Skills that ship with this app (committed under `<repo>/skills`). They are
 * loaded directly from the repo via the pi resource loader so they travel with
 * the deployment — no copying into the user's `~/.pi/agent/skills` required.
 * Override the location with PI_CHATBOT_SKILLS_DIR if the build layout differs.
 */
function getBundledSkillPaths() {
  const skillsRoot =
    process.env.PI_CHATBOT_SKILLS_DIR ?? path.join(process.cwd(), "skills");
  return [path.join(skillsRoot, "brave-search")];
}

function getBundledExtensionPaths() {
  // Resolve the pi-mcp-adapter package directory WITHOUT require.resolve.
  // Turbopack/webpack rewrite `require.resolve("literal")` into a numeric module
  // id at build time (and constant-fold computed specifiers back to literals),
  // so `path.dirname(<number>)` throws
  // `The "path" argument must be of type string. Received type number`.
  // Instead point at the package via node_modules (pnpm/npm symlink the
  // top-level dep there) and realpath it to the real on-disk location.
  const override = process.env.PI_MCP_ADAPTER_DIR;
  if (override) {
    return [override];
  }

  const linked = path.join(process.cwd(), "node_modules", "pi-mcp-adapter");
  try {
    return [realpathSync(linked)];
  } catch {
    return [linked];
  }
}

async function withMcpAdapterEnvironment<T>(
  workspacePath: string,
  action: () => Promise<T>
) {
  const previousQueue = mcpAdapterEnvironmentQueue;
  let releaseQueue: () => void = () => undefined;
  mcpAdapterEnvironmentQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousQueue;

  const isolatedHome = path.join(workspacePath, ".pi", "home");
  const isolatedAgentDir = path.join(workspacePath, ".pi", "agent");
  const previousHome = process.env.HOME;
  const previousPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;

  try {
    await mkdir(isolatedHome, { recursive: true });
    await mkdir(isolatedAgentDir, { recursive: true });
    process.env.HOME = isolatedHome;
    process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;

    return await action();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousPiCodingAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiCodingAgentDir;
    }

    releaseQueue();
  }
}

export async function createPiSdkSession({
  workspacePath,
  sessionFilePath,
  selectedModelId,
  chatId,
  sharedPath,
  chat,
  providerCapture,
}: {
  workspacePath: string;
  sessionFilePath?: string | null;
  selectedModelId?: string;
  chatId: string;
  sharedPath?: string;
  chat?: Chat;
  providerCapture?: ProviderCaptureContext;
}) {
  process.env.MCP_DIRECT_TOOLS = "__none__";
  let mcpConfigPath: string | undefined;

  if (chat) {
    const written = await writeMcpConfigForChat({
      chat,
      conversationPath: workspacePath,
    });
    mcpConfigPath = written.configPath;
  }

  const { agentDir, authStorage, modelRegistry } = createPiModelRegistry();
  const model = withProviderCaptureModel(
    findPiModel({ modelRegistry, selectedModelId }),
    providerCapture
  );

  const sessionManager = sessionFilePath
    ? SessionManager.open(sessionFilePath, undefined, workspacePath)
    : SessionManager.create(workspacePath);

  const created = await withMcpAdapterEnvironment(workspacePath, async () => {
    const resourceLoader = new DefaultResourceLoader({
      cwd: workspacePath,
      agentDir,
      additionalExtensionPaths: getBundledExtensionPaths(),
      additionalSkillPaths: getBundledSkillPaths(),
    });
    await resourceLoader.reload();

    const result = await createAgentSession({
      agentDir,
      authStorage,
      customTools: [
        createFetchWebpageTool(),
        createShowcaseFileTool({
          chatId,
          conversationPath: workspacePath,
          sharedPath,
        }),
      ],
      cwd: workspacePath,
      model,
      modelRegistry,
      sessionManager,
      resourceLoader,
    });

    if (mcpConfigPath) {
      result.session.extensionRunner.setFlagValue("mcp-config", mcpConfigPath);
    }
    await result.session.bindExtensions({});

    return result;
  });

  return created.session;
}
