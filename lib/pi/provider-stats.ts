import type { ChatMessage, ProviderTokenStats } from "@/lib/types";

type ProviderStatsCapture = {
  assistantMessageId?: string;
  completedAt?: string;
  createdAt: string;
  purpose?: string;
  requestIndex: number;
  response?: {
    body?: unknown;
    chunks?: string[];
    rawBody?: string;
  };
  stats?: ProviderTokenStats;
};

type StatsSource = {
  timings?: unknown;
  usage?: unknown;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function withDerivedSpeeds(stats: ProviderTokenStats) {
  const next = { ...stats };

  if (
    next.promptTokensPerSecond === undefined &&
    next.promptTokens !== undefined &&
    next.promptTimeMs !== undefined &&
    next.promptTimeMs > 0
  ) {
    next.promptTokensPerSecond = next.promptTokens / (next.promptTimeMs / 1000);
  }

  if (
    next.generationTokensPerSecond === undefined &&
    next.generatedTokens !== undefined &&
    next.generationTimeMs !== undefined &&
    next.generationTimeMs > 0
  ) {
    next.generationTokensPerSecond =
      next.generatedTokens / (next.generationTimeMs / 1000);
  }

  return next;
}

function mergeStats(
  current: ProviderTokenStats,
  candidate: ProviderTokenStats
) {
  return {
    generatedTokens: candidate.generatedTokens ?? current.generatedTokens,
    generationTimeMs: candidate.generationTimeMs ?? current.generationTimeMs,
    generationTokensPerSecond:
      candidate.generationTokensPerSecond ?? current.generationTokensPerSecond,
    promptTimeMs: candidate.promptTimeMs ?? current.promptTimeMs,
    promptTokens: candidate.promptTokens ?? current.promptTokens,
    promptTokensPerSecond:
      candidate.promptTokensPerSecond ?? current.promptTokensPerSecond,
  };
}

function statsFromSource(source: StatsSource) {
  let stats: ProviderTokenStats = {};
  const timings = objectValue(source.timings);
  if (timings) {
    stats = mergeStats(stats, {
      generatedTokens: finiteNumber(timings.predicted_n),
      generationTimeMs: finiteNumber(timings.predicted_ms),
      generationTokensPerSecond: finiteNumber(timings.predicted_per_second),
      promptTimeMs: finiteNumber(timings.prompt_ms),
      promptTokens: finiteNumber(timings.prompt_n),
      promptTokensPerSecond: finiteNumber(timings.prompt_per_second),
    });
  }

  const usage = objectValue(source.usage);
  if (usage) {
    stats = mergeStats(stats, {
      generatedTokens: finiteNumber(usage.completion_tokens),
      promptTokens: finiteNumber(usage.prompt_tokens),
    });
  }

  return withDerivedSpeeds(stats);
}

function hasStats(
  stats: ProviderTokenStats | undefined
): stats is ProviderTokenStats {
  return Boolean(
    stats &&
      Object.values(stats).some(
        (value) => typeof value === "number" && Number.isFinite(value)
      )
  );
}

function parseJsonLine(line: string) {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function parseSseJsonPayloads(rawBody: string) {
  return rawBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter((line) => line && line !== "[DONE]")
    .map(parseJsonLine)
    .filter(Boolean);
}

function extractProviderStatsFromPayload(value: unknown) {
  const payload = objectValue(value);
  if (!payload) {
    return undefined;
  }

  const direct = statsFromSource(payload);
  if (hasStats(direct)) {
    return direct;
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    const choiceStats = statsFromSource(objectValue(choice) ?? {});
    if (hasStats(choiceStats)) {
      return choiceStats;
    }
  }

  return undefined;
}

export function extractProviderStatsFromResponse(response?: {
  body?: unknown;
  chunks?: string[];
  rawBody?: string;
}) {
  if (!response) {
    return undefined;
  }

  const rawBody = response.rawBody ?? response.chunks?.join("");
  let stats = extractProviderStatsFromPayload(response.body);

  if (rawBody) {
    for (const payload of parseSseJsonPayloads(rawBody)) {
      const chunkStats = extractProviderStatsFromPayload(payload);
      if (hasStats(chunkStats)) {
        stats = mergeStats(stats ?? {}, chunkStats);
      }
    }
  }

  return hasStats(stats) ? withDerivedSpeeds(stats ?? {}) : undefined;
}

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function sortedChatCaptures(captures: ProviderStatsCapture[]) {
  return captures
    .filter((capture) => capture.purpose !== "metadata")
    .map((capture) => ({
      ...capture,
      stats:
        capture.stats ?? extractProviderStatsFromResponse(capture.response),
    }))
    .filter((capture) => hasStats(capture.stats))
    .sort((a, b) => {
      const timeDelta =
        timestamp(a.completedAt ?? a.createdAt) -
        timestamp(b.completedAt ?? b.createdAt);
      return timeDelta === 0 ? a.requestIndex - b.requestIndex : timeDelta;
    });
}

export function applyProviderStatsToMessages(
  messages: ChatMessage[],
  captures: ProviderStatsCapture[]
) {
  const relevantCaptures = sortedChatCaptures(captures);
  if (relevantCaptures.length === 0) {
    return messages;
  }

  const nextMessages = messages.map((message) => ({
    ...message,
    metadata: message.metadata ? { ...message.metadata } : undefined,
    parts: message.parts.map((part) => ({ ...part })),
  }));
  const assignedMessageIndexes = new Set<number>();

  for (const capture of relevantCaptures) {
    const captureStats = capture.stats;
    if (!captureStats) {
      continue;
    }

    let messageIndex = nextMessages.findIndex(
      (message, index) =>
        !assignedMessageIndexes.has(index) &&
        message.role === "assistant" &&
        message.id === capture.assistantMessageId
    );

    if (messageIndex < 0) {
      const captureTime = timestamp(capture.completedAt ?? capture.createdAt);
      messageIndex = nextMessages.findIndex(
        (message, index) =>
          !assignedMessageIndexes.has(index) &&
          message.role === "assistant" &&
          timestamp(message.metadata?.createdAt) + 2000 >= captureTime
      );
    }

    if (messageIndex < 0) {
      messageIndex = nextMessages.findIndex(
        (message, index) =>
          !assignedMessageIndexes.has(index) && message.role === "assistant"
      );
    }

    if (messageIndex < 0) {
      continue;
    }

    assignedMessageIndexes.add(messageIndex);
    const existingMetadata = nextMessages[messageIndex].metadata ?? {
      createdAt: capture.completedAt ?? capture.createdAt,
    };
    nextMessages[messageIndex].metadata = {
      ...existingMetadata,
      providerRequestIndex: capture.requestIndex,
      providerStats: captureStats,
    };
  }

  return nextMessages;
}
