import { expect, test } from "@playwright/test";
import { applyProviderStatsToMessages } from "../../lib/pi/provider-stats";
import type { ChatMessage } from "../../lib/types";

test("aggregates provider stats across each full assistant turn", () => {
  const messages: ChatMessage[] = [
    {
      id: "user-one",
      metadata: { createdAt: "2026-06-19T10:00:00.000Z" },
      parts: [{ text: "First turn", type: "text" }],
      role: "user",
    },
    {
      id: "assistant-tool",
      metadata: {
        createdAt: "2026-06-19T10:00:02.000Z",
        providerStats: { promptTokens: 999 },
      },
      parts: [
        {
          state: "output-available",
          toolCallId: "tool-call",
          toolName: "read",
          type: "tool-pi",
        },
      ],
      role: "assistant",
    },
    {
      id: "assistant-final-one",
      metadata: { createdAt: "2026-06-19T10:00:04.000Z" },
      parts: [{ text: "First final answer", type: "text" }],
      role: "assistant",
    },
    {
      id: "user-two",
      metadata: { createdAt: "2026-06-19T10:01:00.000Z" },
      parts: [{ text: "Second turn", type: "text" }],
      role: "user",
    },
    {
      id: "assistant-final-two",
      metadata: { createdAt: "2026-06-19T10:01:02.000Z" },
      parts: [{ text: "Second final answer", type: "text" }],
      role: "assistant",
    },
  ];
  const captures = [
    {
      assistantMessageId: "run-one",
      completedAt: "2026-06-19T10:00:01.500Z",
      createdAt: "2026-06-19T10:00:01.000Z",
      purpose: "chat",
      requestIndex: 1,
      stats: {
        generatedTokens: 20,
        generationTimeMs: 1000,
        promptTimeMs: 500,
        promptTokens: 100,
      },
    },
    {
      assistantMessageId: "run-one",
      completedAt: "2026-06-19T10:00:03.500Z",
      createdAt: "2026-06-19T10:00:03.000Z",
      purpose: "chat",
      requestIndex: 2,
      stats: {
        generatedTokens: 30,
        generationTimeMs: 1000,
        promptTimeMs: 1500,
        promptTokens: 300,
      },
    },
    {
      assistantMessageId: "run-one",
      createdAt: "2026-06-19T10:00:05.000Z",
      purpose: "metadata",
      requestIndex: 3,
      stats: { generatedTokens: 500, promptTokens: 500 },
    },
    {
      assistantMessageId: "run-two",
      completedAt: "2026-06-19T10:01:01.500Z",
      createdAt: "2026-06-19T10:01:01.000Z",
      purpose: "chat",
      requestIndex: 4,
      stats: {
        generatedTokens: 10,
        generationTimeMs: 500,
        promptTimeMs: 250,
        promptTokens: 50,
      },
    },
  ];

  const result = applyProviderStatsToMessages(messages, captures);

  expect(result[1].metadata?.providerStats).toBeUndefined();
  expect(result[2].metadata?.providerRequestIndex).toBe(2);
  expect(result[2].metadata?.providerStats).toEqual({
    generatedTokens: 50,
    generationTimeMs: 2000,
    generationTokensPerSecond: 25,
    promptTimeMs: 2000,
    promptTokens: 400,
    promptTokensPerSecond: 200,
  });
  expect(result[4].metadata?.providerStats).toEqual({
    generatedTokens: 10,
    generationTimeMs: 500,
    generationTokensPerSecond: 20,
    promptTimeMs: 250,
    promptTokens: 50,
    promptTokensPerSecond: 200,
  });
});

test("does not attach turn stats when the assistant ends with a tool", () => {
  const messages: ChatMessage[] = [
    {
      id: "user-message",
      metadata: { createdAt: "2026-06-19T11:00:00.000Z" },
      parts: [{ text: "Use a tool", type: "text" }],
      role: "user",
    },
    {
      id: "assistant-message",
      metadata: { createdAt: "2026-06-19T11:00:02.000Z" },
      parts: [
        { text: "I will inspect it.", type: "text" },
        {
          state: "output-available",
          toolCallId: "tool-call",
          toolName: "read",
          type: "tool-pi",
        },
      ],
      role: "assistant",
    },
  ];

  const result = applyProviderStatsToMessages(messages, [
    {
      assistantMessageId: "run-id",
      createdAt: "2026-06-19T11:00:01.000Z",
      purpose: "chat",
      requestIndex: 1,
      stats: { generatedTokens: 20, promptTokens: 100 },
    },
  ]);

  expect(result[1].metadata?.providerStats).toBeUndefined();
});
