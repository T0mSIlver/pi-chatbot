import { isFinalAssistantAnswer } from "@/lib/chat-turns";
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
    .filter(
      (
        capture
      ): capture is typeof capture & { stats: ProviderTokenStats } =>
        hasStats(capture.stats)
    )
    .sort((a, b) => {
      const timeDelta =
        timestamp(a.completedAt ?? a.createdAt) -
        timestamp(b.completedAt ?? b.createdAt);
      return timeDelta === 0 ? a.requestIndex - b.requestIndex : timeDelta;
    });
}

type PreparedCapture = ReturnType<typeof sortedChatCaptures>[number];

type Turn = {
  assistantMessageIds: Set<string>;
  endTime?: number;
  finalAssistantAnswerIndex?: number;
  lastAssistantTime?: number;
  startTime?: number;
};

type TotalStatsKey =
  | "generatedTokens"
  | "generationTimeMs"
  | "promptTimeMs"
  | "promptTokens";

function parsedTimestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
}

function sumStats(captures: PreparedCapture[], key: TotalStatsKey) {
  const values = captures
    .map((capture) => capture.stats[key])
    .filter((value): value is number => value !== undefined);
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0)
    : undefined;
}

function aggregateSpeed(
  captures: PreparedCapture[],
  tokenKey: "generatedTokens" | "promptTokens",
  timeKey: "generationTimeMs" | "promptTimeMs",
  speedKey: "generationTokensPerSecond" | "promptTokensPerSecond"
) {
  const relevantCaptures = captures.filter(
    (capture) =>
      capture.stats[tokenKey] !== undefined ||
      capture.stats[timeKey] !== undefined ||
      capture.stats[speedKey] !== undefined
  );
  const canDeriveAggregate =
    relevantCaptures.length > 0 &&
    relevantCaptures.every(
      (capture) =>
        capture.stats[tokenKey] !== undefined &&
        capture.stats[timeKey] !== undefined
    );

  if (canDeriveAggregate) {
    const tokens = relevantCaptures.reduce(
      (total, capture) => total + (capture.stats[tokenKey] ?? 0),
      0
    );
    const timeMs = relevantCaptures.reduce(
      (total, capture) => total + (capture.stats[timeKey] ?? 0),
      0
    );
    return timeMs > 0 ? tokens / (timeMs / 1000) : undefined;
  }

  return relevantCaptures.length === 1
    ? relevantCaptures[0].stats[speedKey]
    : undefined;
}

function aggregateCaptureStats(captures: PreparedCapture[]) {
  const stats: ProviderTokenStats = {
    generatedTokens: sumStats(captures, "generatedTokens"),
    generationTimeMs: sumStats(captures, "generationTimeMs"),
    generationTokensPerSecond: aggregateSpeed(
      captures,
      "generatedTokens",
      "generationTimeMs",
      "generationTokensPerSecond"
    ),
    promptTimeMs: sumStats(captures, "promptTimeMs"),
    promptTokens: sumStats(captures, "promptTokens"),
    promptTokensPerSecond: aggregateSpeed(
      captures,
      "promptTokens",
      "promptTimeMs",
      "promptTokensPerSecond"
    ),
  };

  return hasStats(stats) ? stats : undefined;
}

function createTurn(
  messages: ChatMessage[],
  startIndex: number,
  endIndex: number,
  userIndex?: number
): Turn | null {
  const assistantIndexes: number[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    if (messages[index].role === "assistant") {
      assistantIndexes.push(index);
    }
  }

  const lastAssistantIndex = assistantIndexes.at(-1);
  if (lastAssistantIndex === undefined) {
    return null;
  }

  return {
    assistantMessageIds: new Set(
      assistantIndexes.map((index) => messages[index].id)
    ),
    endTime: parsedTimestamp(messages[endIndex]?.metadata?.createdAt),
    finalAssistantAnswerIndex: isFinalAssistantAnswer(
      messages,
      lastAssistantIndex
    )
      ? lastAssistantIndex
      : undefined,
    lastAssistantTime: parsedTimestamp(
      messages[lastAssistantIndex].metadata?.createdAt
    ),
    startTime: parsedTimestamp(
      userIndex === undefined
        ? messages[startIndex]?.metadata?.createdAt
        : messages[userIndex].metadata?.createdAt
    ),
  };
}

function messageTurns(messages: ChatMessage[]) {
  const userIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : []
  );
  const turns: Turn[] = [];

  const firstUserIndex = userIndexes[0];
  if (firstUserIndex === undefined) {
    const turn = createTurn(messages, 0, messages.length);
    return turn ? [turn] : [];
  }

  if (firstUserIndex > 0) {
    const turn = createTurn(messages, 0, firstUserIndex);
    if (turn) {
      turns.push(turn);
    }
  }

  for (let index = 0; index < userIndexes.length; index += 1) {
    const userIndex = userIndexes[index];
    const endIndex = userIndexes[index + 1] ?? messages.length;
    const turn = createTurn(messages, userIndex, endIndex, userIndex);
    if (turn) {
      turns.push(turn);
    }
  }

  return turns;
}

function captureGroupTime(captures: PreparedCapture[]) {
  for (const capture of captures) {
    const value =
      parsedTimestamp(capture.createdAt) ??
      parsedTimestamp(capture.completedAt);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function findTurnForCaptures({
  captures,
  excludedTurns,
  turns,
}: {
  captures: PreparedCapture[];
  excludedTurns: Set<number>;
  turns: Turn[];
}) {
  const assistantMessageId = captures[0]?.assistantMessageId;
  if (assistantMessageId) {
    const directMatch = turns.findIndex(
      (turn, index) =>
        !excludedTurns.has(index) &&
        turn.assistantMessageIds.has(assistantMessageId)
    );
    if (directMatch >= 0) {
      return directMatch;
    }
  }

  const groupTime = captureGroupTime(captures);
  if (groupTime !== undefined) {
    const intervalMatches = turns
      .map((turn, index) => ({ index, turn }))
      .filter(
        ({ index, turn }) =>
          !excludedTurns.has(index) &&
          (turn.startTime === undefined || groupTime >= turn.startTime - 2000) &&
          (turn.endTime === undefined || groupTime < turn.endTime)
      )
      .sort(
        (a, b) =>
          (b.turn.startTime ?? Number.NEGATIVE_INFINITY) -
          (a.turn.startTime ?? Number.NEGATIVE_INFINITY)
      );
    if (intervalMatches[0]) {
      return intervalMatches[0].index;
    }

    const chronologicalMatch = turns.findIndex(
      (turn, index) =>
        !excludedTurns.has(index) &&
        turn.lastAssistantTime !== undefined &&
        turn.lastAssistantTime + 2000 >= groupTime
    );
    if (chronologicalMatch >= 0) {
      return chronologicalMatch;
    }
  }

  return turns.findIndex((_, index) => !excludedTurns.has(index));
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

  for (const message of nextMessages) {
    if (message.role === "assistant" && message.metadata) {
      delete message.metadata.providerRequestIndex;
      delete message.metadata.providerStats;
    }
  }

  const turns = messageTurns(nextMessages);
  const captureGroups = new Map<string, PreparedCapture[]>();
  const capturesWithoutRunId: PreparedCapture[] = [];
  for (const capture of relevantCaptures) {
    if (!capture.assistantMessageId) {
      capturesWithoutRunId.push(capture);
      continue;
    }
    const existing = captureGroups.get(capture.assistantMessageId) ?? [];
    existing.push(capture);
    captureGroups.set(capture.assistantMessageId, existing);
  }

  const capturesByTurn = new Map<number, PreparedCapture[]>();
  const assignedTurns = new Set<number>();
  for (const captures of captureGroups.values()) {
    const turnIndex = findTurnForCaptures({
      captures,
      excludedTurns: assignedTurns,
      turns,
    });
    if (turnIndex < 0) {
      continue;
    }
    assignedTurns.add(turnIndex);
    capturesByTurn.set(turnIndex, captures);
  }

  for (const capture of capturesWithoutRunId) {
    const turnIndex = findTurnForCaptures({
      captures: [capture],
      excludedTurns: new Set(),
      turns,
    });
    if (turnIndex < 0) {
      continue;
    }
    const existing = capturesByTurn.get(turnIndex) ?? [];
    existing.push(capture);
    capturesByTurn.set(turnIndex, existing);
  }

  for (const [turnIndex, captures] of capturesByTurn) {
    const messageIndex = turns[turnIndex]?.finalAssistantAnswerIndex;
    const stats = aggregateCaptureStats(captures);
    if (messageIndex === undefined || !stats) {
      continue;
    }

    const finalCapture = captures.at(-1);
    const existingMetadata = nextMessages[messageIndex].metadata ?? {
      createdAt:
        finalCapture?.completedAt ??
        finalCapture?.createdAt ??
        new Date().toISOString(),
    };
    nextMessages[messageIndex].metadata = {
      ...existingMetadata,
      providerRequestIndex: Math.max(
        ...captures.map((capture) => capture.requestIndex)
      ),
      providerStats: stats,
    };
  }

  return nextMessages;
}
