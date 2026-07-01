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

const streamdownPlugins = { cjk, code, math, mermaid };

function ReasoningMarkdown({
  className,
  text,
  ...props
}: HTMLAttributes<HTMLDivElement> & { text: string }) {
  return (
    <div
      className={cn(
        "text-[13px] text-muted-foreground/75 leading-[1.65]",
        "[&_blockquote]:border-0 [&_blockquote]:pl-0 [&_blockquote]:text-inherit",
        "[&_code]:text-[12px] [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_pre]:my-2 [&_pre]:max-h-52 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted/35 [&_pre]:p-2",
        className
      )}
      {...props}
    >
      <Streamdown plugins={streamdownPlugins}>{text}</Streamdown>
    </div>
  );
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    preview,
    ...props
  }: ReasoningTriggerProps) => {
    const { isOpen, isStreaming } = useReasoning();
    const previewText = preview?.trim() ? preview : "Thinking...";

    if (isOpen) {
      return null;
    }

    return (
      <div
        className={cn(
          "group/reasoning relative w-full overflow-hidden rounded-md px-2 py-1.5 transition-colors hover:bg-muted/20",
          className
        )}
      >
        {children ?? (
          <div
            className={cn(
              "relative max-h-[3.4rem] overflow-hidden",
              isStreaming && "animate-pulse"
            )}
          >
            <ReasoningMarkdown text={previewText} />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent"
            />
          </div>
        )}
        <CollapsibleTrigger
          aria-label="Expand reasoning"
          className="absolute inset-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring/60"
          {...props}
        >
          <span className="sr-only">Expand reasoning</span>
        </CollapsibleTrigger>
      </div>
    );
  }
);

export type ReasoningContentProps = HTMLAttributes<HTMLDivElement> & {
  children: string;
};

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
          "group/reasoning-content relative animate-in fade-in-0 duration-200 [overflow-anchor:none]",
          className
        )}
      >
        <div
          className="max-h-[260px] overflow-y-auto rounded-md px-2 py-1.5"
          ref={scrollRef}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <ReasoningMarkdown text={children} {...props} />
        </div>
        <CollapsibleTrigger
          aria-label="Collapse reasoning"
          className="absolute top-1 right-1 rounded-sm p-1 text-muted-foreground/40 opacity-45 transition-opacity hover:bg-muted/30 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 group-hover/reasoning-content:opacity-100"
        >
          <ChevronDownIcon className="size-3 rotate-180" />
        </CollapsibleTrigger>
      </div>
    );
  }
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
