import "server-only";

import { createRequire } from "node:module";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { Chat } from "@/lib/db/schema";
import { createFetchWebpageTool } from "./fetch-webpage-tool";
import { writeMcpConfigForChat } from "./mcp-config";
import { createPiModelRegistry, findPiModel } from "./model";
import { withProviderCaptureModel } from "./provider-capture-provider";
import type { ProviderCaptureContext } from "./provider-captures";
import { createShowcaseFileTool } from "./showcase-tool";

const require = createRequire(import.meta.url);

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
  const adapterPackageJson = require.resolve("pi-mcp-adapter/package.json");
  return [path.dirname(adapterPackageJson)];
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

  if (chat) {
    await writeMcpConfigForChat({
      chat,
      conversationPath: workspacePath,
    });
  }

  const { agentDir, authStorage, modelRegistry } = createPiModelRegistry();
  const model = withProviderCaptureModel(
    findPiModel({ modelRegistry, selectedModelId }),
    providerCapture
  );

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

  const created = await createAgentSession({
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

  return created.session;
}
