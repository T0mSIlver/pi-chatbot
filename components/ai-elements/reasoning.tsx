"use client";

import type { ComponentProps, HTMLAttributes } from "react";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { ChevronDownIcon } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Streamdown } from "streamdown";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    const shouldAutoManageStreaming = defaultOpen !== false;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const startTimeRef = useRef<number | null>(null);

    // Track when streaming starts and compute duration
    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

    // Auto-open when streaming starts unless this is a manual preview.
    useEffect(() => {
      if (isStreaming && !isOpen && shouldAutoManageStreaming) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen, shouldAutoManageStreaming]);

    // Auto-close when streaming ends only for the legacy auto-managed mode.
    useEffect(() => {
      if (
        hasEverStreamedRef.current &&
        !isStreaming &&
        isOpen &&
        !hasAutoClosed &&
        shouldAutoManageStreaming
      ) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [
      isStreaming,
      isOpen,
      setIsOpen,
      hasAutoClosed,
      shouldAutoManageStreaming,
    ]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        setIsOpen(newOpen);
      },
      [setIsOpen]
    );

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen]
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn("not-prose", className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);

export type ReasoningTriggerProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  preview?: string;
};

const PREVIEW_CHARACTER_LIMIT = 260;

function getReasoningPreview(preview: string | undefined, fromEnd = false) {
  const text = preview?.replace(/\s+/g, " ").trim();
  if (!text) {
    return "Thinking...";
  }
  if (text.length <= PREVIEW_CHARACTER_LIMIT) {
    return text;
  }
  if (fromEnd) {
    return `...${text.slice(-PREVIEW_CHARACTER_LIMIT).trimStart()}`;
  }
  return `${text.slice(0, PREVIEW_CHARACTER_LIMIT).trimEnd()}...`;
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    preview,
    ...props
  }: ReasoningTriggerProps) => {
    const { isOpen, isStreaming } = useReasoning();
    const previewText = getReasoningPreview(preview, isStreaming);
    const triggerText = isOpen ? "Reasoning" : previewText;

    return (
      <CollapsibleTrigger
        aria-label={isOpen ? "Collapse reasoning" : "Expand reasoning"}
        className={cn(
          "group/reasoning relative flex w-full items-start gap-2 overflow-hidden rounded-md py-1.5 pr-2 pl-3 text-left text-[13px] text-muted-foreground/65 leading-[1.65] transition-colors hover:bg-muted/25 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-1 left-0 w-px bg-gradient-to-b from-transparent via-muted-foreground/30 to-transparent"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-16 -translate-x-full bg-gradient-to-r from-transparent via-foreground/10 to-transparent opacity-0 transition-all duration-700 group-hover/reasoning:translate-x-[520%] group-hover/reasoning:opacity-100"
            />
            <span
              className={cn(
                "min-w-0 flex-1 whitespace-pre-wrap break-words",
                !isOpen && "line-clamp-2",
                isOpen && "font-medium text-muted-foreground/75",
                isStreaming && !isOpen && "animate-pulse"
              )}
            >
              {triggerText}
            </span>
            <ChevronDownIcon
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-transform",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);

export type ReasoningContentProps = HTMLAttributes<HTMLDivElement> & {
  children: string;
};

const streamdownPlugins = { cjk, code, math, mermaid };

export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => {
    const { isStreaming, isOpen } = useReasoning();
    const scrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (isStreaming && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [children, isStreaming]);

    if (!isOpen) return null;

    return (
      <div
        className={cn(
          "mt-2 animate-in fade-in-0 duration-200 text-muted-foreground/60 [overflow-anchor:none]",
          className
        )}
      >
        <div
          className="max-h-[200px] overflow-y-auto rounded-lg border border-border/20 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed"
          ref={scrollRef}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <Streamdown plugins={streamdownPlugins} {...props}>
            {children}
          </Streamdown>
        </div>
      </div>
    );
  }
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
