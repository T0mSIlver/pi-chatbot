export const DEFAULT_CHAT_MODEL = "llamacpp/qwen36dense-27b";

export const titleModel = {
  id: DEFAULT_CHAT_MODEL,
  name: "Qwen 3.6 Dense 27B",
  provider: "llamacpp",
  description: "Local Pi model",
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
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

const piCapabilities: Record<string, ModelCapabilities> = Object.fromEntries(
  chatModels.map((model) => [
    model.id,
    { tools: true, vision: true, reasoning: true },
  ])
);

export function getCapabilities() {
  return piCapabilities;
}

export function getAllPiModels() {
  return chatModels.map((model) => ({
    ...model,
    capabilities: piCapabilities[model.id],
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
