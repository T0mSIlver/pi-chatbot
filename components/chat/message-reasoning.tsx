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
      {/* No top margin: the expanded content's first line must land at the
          same offset as the collapsed preview line (both rely on the inner
          py-1.5) so the top line does not shift down when the block opens. */}
      <ReasoningContent>{reasoning}</ReasoningContent>
    </Reasoning>
  );
}
