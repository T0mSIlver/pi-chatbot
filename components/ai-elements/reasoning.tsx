"use client";

import type { ComponentProps, HTMLAttributes, MouseEvent } from "react";

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
import { MarkdownTable } from "./markdown-table";

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
const markdownComponents = {
  table: MarkdownTable,
};

function getReasoningPreviewLine(preview: string | undefined) {
  return (
    preview
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "Thinking..."
  );
}

function ReasoningMarkdown({
  className,
  streamdownClassName,
  text,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  streamdownClassName?: string;
  text: string;
}) {
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
      <Streamdown
        className={streamdownClassName}
        components={markdownComponents}
        controls={{ code: true, mermaid: true, table: false }}
        plugins={streamdownPlugins}
      >
        {text}
      </Streamdown>
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
    const previewText = getReasoningPreviewLine(preview);

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
              "relative h-[1lh] overflow-hidden text-[13px] leading-[1.65]",
              isStreaming && "animate-pulse"
            )}
          >
            <ReasoningMarkdown
              className="line-clamp-1 overflow-hidden"
              streamdownClassName="!space-y-0 [&_*]:my-0 [&_h1]:inline [&_h2]:inline [&_h3]:inline [&_h4]:inline [&_h5]:inline [&_h6]:inline [&_p]:inline"
              text={previewText}
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
    const { isStreaming, isOpen, setIsOpen } = useReasoning();
    const scrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (isStreaming && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [children, isStreaming]);

    if (!isOpen) return null;

    const handleContentClick = (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("a,button,input,select,textarea,[role='button']")
      ) {
        return;
      }
      if (window.getSelection()?.toString()) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      setIsOpen(false);
    };

    return (
      <div
        className={cn(
          "group/reasoning-content relative cursor-pointer animate-in fade-in-0 duration-200 [overflow-anchor:none]",
          className
        )}
        onClick={handleContentClick}
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
