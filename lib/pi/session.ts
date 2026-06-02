import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { createShowcaseFileTool } from "./showcase-tool";

function splitModelId(modelId: string) {
  const [provider, ...modelParts] = modelId.split("/");
  return {
    provider: modelParts.length > 0 ? provider : "llamacpp",
    modelId: modelParts.length > 0 ? modelParts.join("/") : provider,
  };
}

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

/**
 * Model definitions ship with the app (committed at `<repo>/config/pi-models.json`)
 * so the same providers/models are available on every deployment without writing
 * into `~/.pi/agent/models.json`. Precedence:
 *   1. PI_CHATBOT_MODELS_FILE (explicit override)
 *   2. the bundled repo config, if present
 *   3. the user's ~/.pi/agent/models.json (pi default)
 */
function getModelsJsonPath(agentDir: string) {
  const override = process.env.PI_CHATBOT_MODELS_FILE;
  if (override) {
    return override;
  }
  const bundled = path.join(process.cwd(), "config", "pi-models.json");
  return existsSync(bundled) ? bundled : path.join(agentDir, "models.json");
}

export async function createPiSdkSession({
  workspacePath,
  sessionFilePath,
  selectedModelId,
  chatId,
  sharedPath,
}: {
  workspacePath: string;
  sessionFilePath?: string | null;
  selectedModelId?: string;
  chatId: string;
  sharedPath: string;
}) {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    getModelsJsonPath(agentDir)
  );

  const requested = splitModelId(selectedModelId ?? DEFAULT_CHAT_MODEL);
  const fallback = splitModelId(DEFAULT_CHAT_MODEL);
  const model =
    modelRegistry.find(requested.provider, requested.modelId) ??
    modelRegistry.find(fallback.provider, fallback.modelId);

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
