"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { isValidElement } from "react";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "group not-prose w-full max-w-full overflow-hidden rounded-md border border-border/40 bg-muted/20",
      className
    )}
    {...props}
  />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  className?: string;
} & (
  | { type: ToolUIPart["type"]; state: ToolUIPart["state"]; toolName?: never }
  | {
      type: DynamicToolUIPart["type"];
      state: DynamicToolUIPart["state"];
      toolName: string;
    }
);

const statusLabels: Record<ToolPart["state"], string> = {
  "approval-requested": "approval",
  "approval-responded": "responded",
  "input-available": "running",
  "input-streaming": "writing",
  "output-available": "",
  "output-denied": "denied",
  "output-error": "error",
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}: ToolHeaderProps) => {
  const derivedName =
    type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/25 focus-visible:ring-2 focus-visible:ring-ring/60",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 truncate font-mono text-[12px] text-foreground/75">
          {title ?? derivedName}
        </span>
        {statusLabels[state] && (
          <span
            className={cn(
              "shrink-0 text-[11px] text-muted-foreground/60",
              (state === "input-available" || state === "input-streaming") &&
                "animate-pulse",
              state === "output-error" && "text-destructive"
            )}
          >
            {statusLabels[state]}
          </span>
        )}
      </div>
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/45 transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 divide-y divide-border/40 border-border/40 border-t text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
  inputText?: string;
};

function parseInputText(inputText: string | undefined) {
  if (!inputText) {
    return undefined;
  }

  try {
    return JSON.parse(inputText) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonStringLiteral(source: string, startIndex: number) {
  if (source[startIndex] !== '"') {
    return null;
  }

  let escaped = false;
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      try {
        return {
          endIndex: index + 1,
          value: JSON.parse(source.slice(startIndex, index + 1)) as string,
        };
      } catch {
        return null;
      }
    }
  }

  return null;
}

function decodePartialStringValue(source: string) {
  let text = source.trim();
  if (!text.startsWith('"')) {
    return undefined;
  }

  text = text.slice(1);
  if (text.endsWith('"') && !text.endsWith('\\"')) {
    text = text.slice(0, -1);
  }

  return text
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function parsePartialInputText(inputText: string | undefined) {
  if (!inputText?.trim().startsWith("{")) {
    return undefined;
  }

  const fields: Record<string, unknown> = {};
  let index = 1;

  while (index < inputText.length) {
    while (/[\s,]/.test(inputText[index] ?? "")) {
      index += 1;
    }

    const key = parseJsonStringLiteral(inputText, index);
    if (!key) {
      break;
    }
    index = key.endIndex;

    while (/\s/.test(inputText[index] ?? "")) {
      index += 1;
    }
    if (inputText[index] !== ":") {
      break;
    }
    index += 1;

    const valueStart = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    while (index < inputText.length) {
      const char = inputText[index];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = !inString;
      } else if (!inString && (char === "{" || char === "[")) {
        depth += 1;
      } else if (!inString && (char === "}" || char === "]")) {
        if (depth === 0 && char === "}") {
          break;
        }
        depth = Math.max(0, depth - 1);
      } else if (!inString && depth === 0 && char === ",") {
        break;
      }
      index += 1;
    }

    const rawValue = inputText.slice(valueStart, index).trim();
    const partialStringValue = decodePartialStringValue(rawValue);
    if (partialStringValue !== undefined) {
      fields[key.value] = partialStringValue;
    } else {
      try {
        fields[key.value] = JSON.parse(rawValue);
      } catch {
        fields[key.value] = rawValue;
      }
    }

    if (inputText[index] === ",") {
      index += 1;
    } else {
      break;
    }
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function formatToolValue(value: unknown) {
  if (value === undefined) {
    return "";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isEmptyToolValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

const ToolValueBlock = ({
  tone = "default",
  value,
}: {
  tone?: "default" | "error" | "muted";
  value: unknown;
}) => {
  if (isValidElement(value)) {
    return (
      <div
        className={cn(
          "max-h-72 overflow-auto px-3 py-2 text-[12px] leading-5",
          tone === "muted" && "text-muted-foreground",
          tone === "error" && "text-destructive"
        )}
      >
        {value as ReactNode}
      </div>
    );
  }

  return (
    <pre
      className={cn(
        "max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-5 [overflow-wrap:anywhere] [tab-size:2]",
        tone === "muted" && "text-muted-foreground",
        tone === "error" && "text-destructive",
        tone === "default" && "text-foreground/90"
      )}
    >
      {formatToolValue(value)}
    </pre>
  );
};

export const ToolInput = ({
  className,
  input,
  inputText,
  ...props
}: ToolInputProps) => {
  const parsedInputText =
    parseInputText(inputText) ?? parsePartialInputText(inputText);
  const value = input ?? parsedInputText;
  const displayValue = value ?? inputText ?? "";

  if (isEmptyToolValue(displayValue)) {
    return null;
  }

  return (
    <div className={cn("min-w-0 overflow-hidden", className)} {...props}>
      <ToolValueBlock tone="muted" value={displayValue} />
    </div>
  );
};

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolPart["output"];
  errorText: ToolPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  const displayValue = errorText ?? output;

  if (isEmptyToolValue(displayValue)) {
    return null;
  }

  return (
    <div className={cn("min-w-0 overflow-hidden", className)} {...props}>
      <ToolValueBlock
        tone={errorText ? "error" : "default"}
        value={displayValue}
      />
    </div>
  );
};
