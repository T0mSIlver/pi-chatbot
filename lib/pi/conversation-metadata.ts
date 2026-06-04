import "server-only";

import { completeSimple } from "@mariozechner/pi-ai";
import {
  buildSessionContext,
  convertToLlm,
  type SessionEntry,
  serializeConversation,
} from "@mariozechner/pi-coding-agent";
import { z } from "zod";
import { isTestEnvironment } from "@/lib/constants";
import { createPiModelRegistry, findPiModel } from "./model";

const MAX_TRANSCRIPT_CHARS = 12_000;
const METADATA_TIMEOUT_MS = 20_000;

const metadataSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(400),
});

export type ConversationMetadata = z.infer<typeof metadataSchema>;

const rawMetadataSchema = z.object({
  title: z.string().optional().catch(""),
  summary: z.string().optional().catch(""),
});

function clampTranscript(transcript: string) {
  if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
    return transcript;
  }

  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return [
    transcript.slice(0, half),
    "\n\n[...middle of transcript omitted for metadata generation...]\n\n",
    transcript.slice(-half),
  ].join("");
}

function cleanTitle(value: string) {
  return (
    value
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .replace(/^[#*"\s]+/, "")
      .replace(/[".]+$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64) || "New conversation"
  );
}

function cleanSummary(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function createMetadataSignal(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Conversation metadata timed out."));
  }, METADATA_TIMEOUT_MS);
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function normalizeMetadata({
  title,
  summary,
}: {
  title: string;
  summary: string;
}): ConversationMetadata {
  const normalized = {
    title: cleanTitle(title),
    summary: cleanSummary(summary),
  };

  return metadataSchema.parse({
    title: normalized.title || "New conversation",
    summary:
      normalized.summary ||
      "The conversation has started and will be summarized after more context.",
  });
}

function parseMetadata(text: string): ConversationMetadata {
  const unwrapped = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  const jsonText =
    start >= 0 && end >= start ? unwrapped.slice(start, end + 1) : unwrapped;

  try {
    const parsed = rawMetadataSchema.parse(JSON.parse(jsonText));
    return normalizeMetadata({
      title: parsed.title ?? "",
      summary: parsed.summary ?? "",
    });
  } catch {
    const title =
      unwrapped.match(/(?:^|\n)\s*title\s*[:=-]\s*(.+)/i)?.[1] ??
      unwrapped.split("\n").find((line) => line.trim()) ??
      "New conversation";
    const summary =
      unwrapped.match(/(?:^|\n)\s*summary\s*[:=-]\s*(.+)/i)?.[1] ??
      unwrapped
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(1)
        .join(" ") ??
      "";

    return normalizeMetadata({ title, summary });
  }
}

function fallbackConversationMetadata(entries: SessionEntry[]) {
  const transcript = serializeConversation(
    convertToLlm(buildSessionContext(entries).messages)
  );
  const firstUserLine =
    transcript
      .split("\n")
      .find((line) => line.startsWith("[User]:"))
      ?.replace("[User]:", "")
      .trim() || "Mock conversation";
  const firstAssistantLine = transcript
    .split("\n")
    .find((line) => line.startsWith("[Assistant]:"))
    ?.replace("[Assistant]:", "")
    .trim();

  return normalizeMetadata({
    title: firstUserLine,
    summary:
      firstAssistantLine ||
      "The conversation has started and will be summarized after more context.",
  });
}

export async function generateConversationMetadata({
  entries,
  selectedModelId,
  signal,
}: {
  entries: SessionEntry[];
  selectedModelId?: string;
  signal?: AbortSignal;
}): Promise<ConversationMetadata | null> {
  if (entries.length === 0) {
    return null;
  }

  if (isTestEnvironment) {
    return fallbackConversationMetadata(entries);
  }

  const fallbackMetadata = fallbackConversationMetadata(entries);

  const metadataAbort = createMetadataSignal(signal);

  try {
    const transcript = clampTranscript(
      serializeConversation(convertToLlm(buildSessionContext(entries).messages))
    );
    const { modelRegistry } = createPiModelRegistry();
    const model = findPiModel({ modelRegistry, selectedModelId });

    if (!model) {
      return fallbackMetadata;
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return fallbackMetadata;
    }

    const response = await completeSimple(
      model,
      {
        systemPrompt:
          "You generate concise metadata for a coding assistant conversation. Return only valid JSON.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Create metadata for the conversation in <conversation>. Return exactly this JSON shape and nothing else:
{"title":"2-6 words, max 60 characters","summary":"One sentence, max 180 characters"}

Rules:
- Base the title on the user's real task and the assistant's result.
- Do not include prefixes like "Title:".
- Do not mention that this is a chat, conversation, summary, or transcript.
- If the task is only a greeting or too vague, use "New conversation".

<conversation>
${transcript}
</conversation>`,
              },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 384,
        reasoning: model.reasoning ? "minimal" : undefined,
        signal: metadataAbort.signal,
        temperature: 0.1,
      }
    );

    if (response.stopReason === "error") {
      return fallbackMetadata;
    }

    const text = response.content
      .filter((part): part is { type: "text"; text: string } => {
        return part.type === "text";
      })
      .map((part) => part.text)
      .join("\n")
      .trim();

    return text ? parseMetadata(text) : fallbackMetadata;
  } catch (error) {
    console.error("Failed to generate conversation metadata:", error);
    return fallbackMetadata;
  } finally {
    metadataAbort.dispose();
  }
}
