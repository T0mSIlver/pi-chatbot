import piModelsConfig from "@/config/pi-models.json";

export const DEFAULT_CHAT_MODEL = "llamacpp/qwen36dense-27b";
export const DEFAULT_LLAMA_CPP_BASE_URL = "http://192.168.1.183:8080/v1";
const LLAMA_CPP_FETCH_TIMEOUT_MS = 2000;

export const titleModel = {
  id: DEFAULT_CHAT_MODEL,
  name: "Qwen 3.6 Dense 27B",
  provider: "llamacpp",
  description: "Local Pi model",
};

export type ModelModality =
  | "text"
  | "image"
  | "audio"
  | "video"
  // Allow future server-defined modality names beyond the known set.
  | (string & {});

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
  audio: boolean;
  video: boolean;
  inputModalities: ModelModality[];
  outputModalities: ModelModality[];
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "llamacpp/qwen36a3b-35b",
    name: "Qwen 3.6 A3B 35B",
    provider: "llamacpp",
    description: "Local Pi reasoning model",
  },
  {
    id: "llamacpp/qwen36dense-27b",
    name: "Qwen 3.6 Dense 27B",
    provider: "llamacpp",
    description: "Local Pi reasoning model",
  },
  {
    id: "llamacpp/gemma4-31b",
    name: "Gemma 4 31B",
    provider: "llamacpp",
    description: "Local Pi reasoning model",
  },
  {
    id: "llamacpp/gemma4-26b-a4b",
    name: "Gemma 4 26B A4B",
    provider: "llamacpp",
    description: "Local Pi reasoning model",
  },
];

function getLlamaCppBaseUrl() {
  const configuredUrl =
    process.env.LLAMA_CPP_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    DEFAULT_LLAMA_CPP_BASE_URL;

  return configuredUrl.replace(/\/+$/, "");
}

function getServerModelId(modelId: string) {
  const [, ...modelParts] = modelId.split("/");
  return modelParts.length > 0 ? modelParts.join("/") : modelId;
}

function normalizeModalities(value: unknown): ModelModality[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (modality): modality is ModelModality =>
      typeof modality === "string" && modality.length > 0
  );
}

function createModelCapabilities({
  inputModalities = [],
  outputModalities = [],
  reasoning = false,
  tools = false,
}: {
  inputModalities?: ModelModality[];
  outputModalities?: ModelModality[];
  reasoning?: boolean;
  tools?: boolean;
} = {}): ModelCapabilities {
  return {
    tools,
    vision: inputModalities.includes("image"),
    reasoning,
    audio:
      inputModalities.includes("audio") || outputModalities.includes("audio"),
    video:
      inputModalities.includes("video") || outputModalities.includes("video"),
    inputModalities,
    outputModalities,
  };
}

const emptyCapabilities = createModelCapabilities();

/**
 * Capabilities known at build time from the bundled `config/pi-models.json`
 * (the same file the model registry loads). These are the source of truth when
 * the live llama.cpp probe is unreachable, times out, or doesn't report
 * modality metadata — so a transient probe failure never silently disables
 * image upload for a model the config already declares as vision-capable.
 */
function buildBaselineCapabilities(): Record<string, ModelCapabilities> {
  const entries: [string, ModelCapabilities][] = [];

  for (const [provider, providerConfig] of Object.entries(
    piModelsConfig.providers ?? {}
  )) {
    for (const model of providerConfig.models ?? []) {
      const inputModalities = normalizeModalities(model.input);

      entries.push([
        `${provider}/${model.id}`,
        createModelCapabilities({
          inputModalities:
            inputModalities.length > 0 ? inputModalities : ["text"],
          reasoning: Boolean(model.reasoning),
          tools: true,
        }),
      ]);
    }
  }

  return Object.fromEntries(entries);
}

const baselineCapabilities = buildBaselineCapabilities();

type LlamaCppModel = {
  id: string;
  object?: string;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  };
};

async function getLlamaCppModelCapabilities() {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LLAMA_CPP_FETCH_TIMEOUT_MS
  );

  try {
    const res = await fetch(`${getLlamaCppBaseUrl()}/models`, {
      next: { revalidate: 300 },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {};
    }

    const json = await res.json();
    const models = Array.isArray(json.data) ? json.data : [];

    return Object.fromEntries(
      models
        .filter(
          (model: LlamaCppModel) =>
            typeof model.id === "string" &&
            (model.object === undefined || model.object === "model")
        )
        .map((model: LlamaCppModel) => {
          const inputModalities = normalizeModalities(
            model.architecture?.input_modalities
          );
          const outputModalities = normalizeModalities(
            model.architecture?.output_modalities
          );

          return [
            model.id,
            createModelCapabilities({
              inputModalities,
              outputModalities,
            }),
          ];
        })
    );
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  const serverCapabilities = await getLlamaCppModelCapabilities();

  return Object.fromEntries(
    chatModels.map((model) => {
      const live = serverCapabilities[getServerModelId(model.id)];
      // Only trust the live probe when it actually reported modalities;
      // otherwise fall back to the config-declared baseline so a missing or
      // mismatched probe response can't strip a model's known capabilities.
      const liveHasModalities =
        live !== undefined &&
        (live.inputModalities.length > 0 || live.outputModalities.length > 0);
      const baseline = baselineCapabilities[model.id] ?? emptyCapabilities;

      return [model.id, liveHasModalities ? live : baseline];
    })
  );
}

export async function getAllPiModels() {
  const capabilities = await getCapabilities();

  return chatModels.map((model) => ({
    ...model,
    capabilities: capabilities[model.id],
  }));
}

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
