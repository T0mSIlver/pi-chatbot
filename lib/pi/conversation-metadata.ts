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

const metadataSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(400),
});

export type ConversationMetadata = z.infer<typeof metadataSchema>;

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

function textFromAssistantResponse(content: ConversationMetadata) {
  return {
    title: cleanTitle(content.title),
    summary: cleanSummary(content.summary),
  };
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

  return textFromAssistantResponse(metadataSchema.parse(JSON.parse(jsonText)));
}

function mockConversationMetadata(entries: SessionEntry[]) {
  const transcript = serializeConversation(
    convertToLlm(buildSessionContext(entries).messages)
  );
  const firstUserLine =
    transcript
      .split("\n")
      .find((line) => line.startsWith("[User]:"))
      ?.replace("[User]:", "")
      .trim() || "Mock conversation";

  return {
    title: cleanTitle(firstUserLine),
    summary: "A mocked Pi turn created workspace output for test coverage.",
  };
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
    return mockConversationMetadata(entries);
  }

  try {
    const transcript = clampTranscript(
      serializeConversation(convertToLlm(buildSessionContext(entries).messages))
    );
    const { modelRegistry } = createPiModelRegistry();
    const model = findPiModel({ modelRegistry, selectedModelId });

    if (!model) {
      return null;
    }

    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      return null;
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
        signal,
        temperature: 0.1,
      }
    );

    if (response.stopReason === "error") {
      return null;
    }

    const text = response.content
      .filter((part): part is { type: "text"; text: string } => {
        return part.type === "text";
      })
      .map((part) => part.text)
      .join("\n")
      .trim();

    return text ? parseMetadata(text) : null;
  } catch (error) {
    console.error("Failed to generate conversation metadata:", error);
    return null;
  }
}
