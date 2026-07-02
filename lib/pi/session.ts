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
import { getPiChatbotHome } from "./workspace";

let extensionEnvironmentQueue = Promise.resolve();

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

function resolveNodeModulePackageDir(packageName: string, override?: string) {
  if (override) {
    return override;
  }

  const linked = path.join(process.cwd(), "node_modules", packageName);
  try {
    return realpathSync(linked);
  } catch {
    return linked;
  }
}

function getBundledExtensionPaths() {
  // Resolve extension package directories WITHOUT require.resolve.
  // Turbopack/webpack rewrite `require.resolve("literal")` into a numeric module
  // id at build time (and constant-fold computed specifiers back to literals),
  // so `path.dirname(<number>)` throws
  // `The "path" argument must be of type string. Received type number`.
  // Instead point at the package via node_modules (pnpm/npm symlink the
  // top-level dep there) and realpath it to the real on-disk location.
  return [
    resolveNodeModulePackageDir(
      "pi-mcp-adapter",
      process.env.PI_MCP_ADAPTER_DIR
    ),
    process.env.PI_HERMES_MEMORY_EXTENSION_PATH ??
      path.join(process.cwd(), "pi-extensions", "hermes-memory.ts"),
  ];
}

function safeStateSegment(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function getExtensionStatePaths() {
  const root = path.join(getPiChatbotHome(), "extension-state");

  return {
    agentDir: path.join(root, "agent"),
    home: path.join(root, "home"),
  };
}

function getHermesProjectCwd(chat?: Chat) {
  const { home } = getExtensionStatePaths();
  if (!chat?.projectId) {
    return home;
  }

  return path.join(
    getPiChatbotHome(),
    "extension-state",
    "projects",
    safeStateSegment(chat.projectId)
  );
}

async function withExtensionEnvironment<T>(
  chat: Chat | undefined,
  action: () => Promise<T>
) {
  const previousQueue = extensionEnvironmentQueue;
  let releaseQueue: () => void = () => undefined;
  extensionEnvironmentQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousQueue;

  const { agentDir: extensionAgentDir, home: extensionHome } =
    getExtensionStatePaths();
  const hermesProjectCwd = getHermesProjectCwd(chat);
  const previousHome = process.env.HOME;
  const previousPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousHermesProjectCwd = process.env.PI_CHATBOT_HERMES_PROJECT_CWD;

  try {
    await mkdir(extensionHome, { recursive: true });
    await mkdir(extensionAgentDir, { recursive: true });
    await mkdir(hermesProjectCwd, { recursive: true });
    process.env.HOME = extensionHome;
    process.env.PI_CODING_AGENT_DIR = extensionAgentDir;
    process.env.PI_CHATBOT_HERMES_PROJECT_CWD = hermesProjectCwd;

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

    if (previousHermesProjectCwd === undefined) {
      delete process.env.PI_CHATBOT_HERMES_PROJECT_CWD;
    } else {
      process.env.PI_CHATBOT_HERMES_PROJECT_CWD = previousHermesProjectCwd;
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

  const created = await withExtensionEnvironment(chat, async () => {
    // Create the SessionManager *inside* the extension environment so a new
    // session file lands under PI_CODING_AGENT_DIR (extension-state/agent) —
    // the same tree Hermes derives its AGENT_ROOT/sessions from. Created
    // outside the window it would default to the ambient ~/.pi/agent/sessions,
    // which Hermes never scans, so its session-search backfill would silently
    // index nothing. SessionManager.open reuses the stored absolute session
    // path, so it is location-independent; it lives here only for symmetry.
    const sessionManager = sessionFilePath
      ? SessionManager.open(sessionFilePath, undefined, workspacePath)
      : SessionManager.create(workspacePath);

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
