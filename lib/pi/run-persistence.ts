import "server-only";

import {
  checkpointRunPartial,
  markRunTerminal,
  startRunRecord,
} from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";
import type { RunPersistence } from "./chat-runs";

const CHECKPOINT_INTERVAL_MS = 1000;

function inflightAssistantMessage(
  messages: ChatMessage[],
  assistantMessageId: string
): ChatMessage | null {
  const message = messages.find(
    (candidate) =>
      candidate.id === assistantMessageId && candidate.role === "assistant"
  );
  return message && message.parts.length > 0 ? message : null;
}

export function createRunPersistence(): RunPersistence {
  // Per-run promise chains so onTerminal can never land before onStart, and
  // checkpoints stay ordered (last write wins). Single user → tiny maps.
  const chains = new Map<string, Promise<unknown>>();
  const lastCheckpointAt = new Map<string, number>();

  const enqueue = (runId: string, task: () => Promise<unknown>) => {
    const next = (chains.get(runId) ?? Promise.resolve())
      .then(task)
      .catch((error) => {
        console.error("[run-persistence]", runId, error);
      });
    chains.set(runId, next);
    return next;
  };

  return {
    onStart: ({ runId, chatId, assistantMessageId }) => {
      enqueue(runId, () =>
        startRunRecord({ id: runId, chatId, assistantMessageId })
      );
    },

    onCheckpoint: ({ runId, assistantMessageId }, messages) => {
      const now = Date.now();
      if (now - (lastCheckpointAt.get(runId) ?? 0) < CHECKPOINT_INTERVAL_MS) {
        return;
      }
      lastCheckpointAt.set(runId, now);
      const partial = inflightAssistantMessage(messages, assistantMessageId);
      if (!partial) {
        return;
      }
      enqueue(runId, () => checkpointRunPartial({ id: runId, partial }));
    },

    onTerminal: ({ runId, assistantMessageId }, status, error, messages) => {
      lastCheckpointAt.delete(runId);
      // Keep a partial only for abnormal endings; a completed run is already
      // fully in the JSONL transcript.
      const partial =
        status === "completed"
          ? undefined
          : (inflightAssistantMessage(messages, assistantMessageId) ?? null);
      enqueue(runId, () =>
        markRunTerminal({ id: runId, status, error, partial })
      ).finally(() => {
        chains.delete(runId);
      });
    },
  };
}

export const runPersistence = createRunPersistence();
