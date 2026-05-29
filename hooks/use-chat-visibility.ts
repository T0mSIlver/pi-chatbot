"use client";

import type { VisibilityType } from "@/components/chat/visibility-selector";

export function useChatVisibility(_args?: unknown) {
  return {
    visibilityType: "private" as VisibilityType,
    setVisibilityType: (_visibilityType: VisibilityType) => undefined,
  };
}
