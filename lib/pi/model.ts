import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  getAgentDir,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";

function splitModelId(modelId: string) {
  const [provider, ...modelParts] = modelId.split("/");
  return {
    provider: modelParts.length > 0 ? provider : "llamacpp",
    modelId: modelParts.length > 0 ? modelParts.join("/") : provider,
  };
}

/**
 * Model definitions ship with the app (committed at `<repo>/config/pi-models.json`)
 * so the same providers/models are available on every deployment without writing
 * into `~/.pi/agent/models.json`. Precedence:
 *   1. PI_CHATBOT_MODELS_FILE (explicit override)
 *   2. the bundled repo config, if present
 *   3. the user's ~/.pi/agent/models.json (pi default)
 */
export function getModelsJsonPath(agentDir: string) {
  const override = process.env.PI_CHATBOT_MODELS_FILE;
  if (override) {
    return override;
  }
  const bundled = path.join(process.cwd(), "config", "pi-models.json");
  return existsSync(bundled) ? bundled : path.join(agentDir, "models.json");
}

export function createPiModelRegistry() {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    getModelsJsonPath(agentDir)
  );

  return { agentDir, authStorage, modelRegistry };
}

export function findPiModel({
  modelRegistry,
  selectedModelId,
}: {
  modelRegistry: ModelRegistry;
  selectedModelId?: string;
}): Model<any> | undefined {
  const requested = splitModelId(selectedModelId ?? DEFAULT_CHAT_MODEL);
  const fallback = splitModelId(DEFAULT_CHAT_MODEL);

  return (
    modelRegistry.find(requested.provider, requested.modelId) ??
    modelRegistry.find(fallback.provider, fallback.modelId)
  );
}
