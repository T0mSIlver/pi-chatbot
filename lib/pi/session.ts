import "server-only";

import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { createFetchWebpageTool } from "./fetch-webpage-tool";
import { createPiModelRegistry, findPiModel } from "./model";
import { withProviderCaptureModel } from "./provider-capture-provider";
import type { ProviderCaptureContext } from "./provider-captures";
import { createShowcaseFileTool } from "./showcase-tool";

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

export async function createPiSdkSession({
  workspacePath,
  sessionFilePath,
  selectedModelId,
  chatId,
  sharedPath,
  providerCapture,
}: {
  workspacePath: string;
  sessionFilePath?: string | null;
  selectedModelId?: string;
  chatId: string;
  sharedPath: string;
  providerCapture?: ProviderCaptureContext;
}) {
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
