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
import { Shimmer } from "./shimmer";

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
    // The open state belongs to the user: no auto-open/auto-close
    // side effects that could fight a manual toggle or leave the
    // block locked shut.
    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: defaultOpen ?? false,
      onChange: onOpenChange,
      prop: open,
    });
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const startTimeRef = useRef<number | null>(null);

    // Track when streaming starts and compute duration
    useEffect(() => {
      if (isStreaming) {
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

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

function getReasoningPreviewLines(preview: string | undefined) {
  return (
    preview
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? []
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
    const previewRef = useRef<HTMLDivElement>(null);
    const [isPreviewOverflowing, setIsPreviewOverflowing] = useState(false);
    const previewLines = getReasoningPreviewLines(preview);
    // While streaming, surface the newest thought; settled, the first
    // line summarizes the block.
    const previewText =
      (isStreaming ? previewLines.at(-1) : previewLines[0]) ?? "Thinking...";
    const hasCustomPreview = children !== undefined;
    const hasMultipleLines = previewLines.length > 1;
    // Overflow measurement can misdetect (fonts, timing); the length
    // fallback guarantees long one-liners stay reopenable, and a
    // streaming block is always expandable since it is still growing.
    const isExpandable =
      hasCustomPreview ||
      hasMultipleLines ||
      isPreviewOverflowing ||
      isStreaming ||
      previewText.length > 160;

    useEffect(() => {
      if (hasCustomPreview || hasMultipleLines) {
        setIsPreviewOverflowing(false);
        return;
      }

      const previewElement = previewRef.current;
      const measuredElement = previewElement?.firstElementChild;
      if (!(measuredElement instanceof HTMLElement)) {
        setIsPreviewOverflowing(false);
        return;
      }

      const updateOverflow = () => {
        const hasOverflow =
          measuredElement.scrollHeight > measuredElement.clientHeight + 1 ||
          measuredElement.scrollWidth > measuredElement.clientWidth + 1;
        setIsPreviewOverflowing((current) =>
          current === hasOverflow ? current : hasOverflow
        );
      };

      updateOverflow();

      if (typeof ResizeObserver === "undefined") {
        return;
      }

      const observer = new ResizeObserver(updateOverflow);
      observer.observe(measuredElement);
      return () => observer.disconnect();
    }, [hasCustomPreview, hasMultipleLines, previewText]);

    if (isOpen) {
      return null;
    }

    return (
      <div
        className={cn(
          // Negative margin keeps the preview text flush with regular
          // content while the hover background bleeds past the edge.
          "group/reasoning -mx-2 relative w-[calc(100%+1rem)] overflow-hidden rounded-md px-2 py-1.5 transition-colors",
          isExpandable && "hover:bg-muted/20",
          className
        )}
      >
        {children ?? (
          <div
            className="relative h-[1lh] overflow-hidden text-[13px] leading-[1.65]"
            ref={previewRef}
          >
            {isStreaming ? (
              // Same treatment as streaming tool args: motion, not badges.
              <Shimmer
                as="div"
                className="truncate text-[13px] leading-[1.65]"
                duration={1.4}
              >
                {previewText}
              </Shimmer>
            ) : (
              <ReasoningMarkdown
                className="line-clamp-1 overflow-hidden"
                streamdownClassName="!space-y-0 [&_*]:my-0 [&_h1]:inline [&_h2]:inline [&_h3]:inline [&_h4]:inline [&_h5]:inline [&_h6]:inline [&_p]:inline"
                text={previewText}
              />
            )}
          </div>
        )}
        {isExpandable && (
          <CollapsibleTrigger
            aria-label="Expand reasoning"
            className="absolute inset-0 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring/60"
            {...props}
          >
            <span className="sr-only">Expand reasoning</span>
          </CollapsibleTrigger>
        )}
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
          // No indicator while open: pointer cursor and a hover tint
          // signal that clicking anywhere collapses the block. Negative
          // margin keeps the text flush with regular content.
          "group/reasoning-content -mx-2 relative w-[calc(100%+1rem)] cursor-pointer rounded-md transition-colors animate-in fade-in-0 duration-200 [overflow-anchor:none] hover:bg-muted/20",
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
        {/* Invisible to pointer users; reachable with the keyboard. */}
        <CollapsibleTrigger
          aria-label="Collapse reasoning"
          className="pointer-events-none absolute top-1 right-1 rounded-sm p-1 text-[11px] text-muted-foreground opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Collapse
        </CollapsibleTrigger>
      </div>
    );
  }
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
