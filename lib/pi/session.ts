import "server-only";

import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";

function splitModelId(modelId: string) {
  const [provider, ...modelParts] = modelId.split("/");
  return {
    provider: modelParts.length > 0 ? provider : "llamacpp",
    modelId: modelParts.length > 0 ? modelParts.join("/") : provider,
  };
}

export async function createPiSdkSession({
  workspacePath,
  sessionFilePath,
  selectedModelId,
}: {
  workspacePath: string;
  sessionFilePath?: string | null;
  selectedModelId?: string;
}) {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    path.join(agentDir, "models.json")
  );

  const requested = splitModelId(selectedModelId ?? DEFAULT_CHAT_MODEL);
  const fallback = splitModelId(DEFAULT_CHAT_MODEL);
  const model =
    modelRegistry.find(requested.provider, requested.modelId) ??
    modelRegistry.find(fallback.provider, fallback.modelId);

  const sessionManager = sessionFilePath
    ? SessionManager.open(sessionFilePath, undefined, workspacePath)
    : SessionManager.create(workspacePath);

  const created = await createAgentSession({
    agentDir,
    authStorage,
    cwd: workspacePath,
    model,
    modelRegistry,
    sessionManager,
  });

  return created.session;
}
