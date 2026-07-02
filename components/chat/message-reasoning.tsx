"use client";

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../ai-elements/reasoning";

type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
};

export function MessageReasoning({
  isLoading,
  reasoning,
}: MessageReasoningProps) {
  return (
    <Reasoning
      className="w-full max-w-[760px]"
      data-testid="message-reasoning"
      defaultOpen={false}
      isStreaming={isLoading}
    >
      <ReasoningTrigger preview={reasoning} />
      <ReasoningContent className="mt-1.5">{reasoning}</ReasoningContent>
    </Reasoning>
  );
}
