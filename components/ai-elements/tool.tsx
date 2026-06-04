"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { isValidElement } from "react";

import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
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
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolPart["state"], ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": (
    <span
      aria-hidden="true"
      className="relative flex size-4 items-center justify-center"
    >
      <CircleIcon className="absolute size-4 animate-ping text-blue-500/60" />
      <CircleIcon className="size-2.5 fill-blue-500 text-blue-500" />
    </span>
  ),
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolPart["state"]) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

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
        "flex w-full items-center justify-between gap-4 p-3",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <WrenchIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title ?? derivedName}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolPart["input"];
  inputText?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatFieldName(name: string) {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

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

function formatScalarValue(value: unknown) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

const ToolInputValue = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">[]</span>;
    }

    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div className="grid gap-0.5" key={`item-${index}-${typeof item}`}>
            <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {index + 1}.
            </span>
            <ToolInputValue value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (isPlainRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-muted-foreground">{"{}"}</span>;
    }

    return (
      <div className="space-y-2">
        {entries.map(([key, nestedValue]) => (
          <div className="grid gap-1" key={key}>
            <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
              {formatFieldName(key)}
            </div>
            <ToolInputValue value={nestedValue} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <span className="block whitespace-pre-wrap break-words text-[12px] leading-5">
      {formatScalarValue(value)}
    </span>
  );
};

const StreamingInputDraft = ({ inputText }: { inputText: string }) => (
  <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[12px] leading-5">
    <div className="mb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
      Writing
    </div>
    <div className="whitespace-pre-wrap break-words font-sans text-foreground/90">
      {inputText || "Preparing parameters..."}
    </div>
  </div>
);

export const ToolInput = ({
  className,
  input,
  inputText,
  ...props
}: ToolInputProps) => {
  const parsedInputText =
    parseInputText(inputText) ?? parsePartialInputText(inputText);
  const value = input ?? parsedInputText;

  return (
    <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Parameters
      </h4>
      <div className="rounded-md bg-muted/40 p-3 font-sans">
        {value === undefined && inputText !== undefined ? (
          <StreamingInputDraft inputText={inputText} />
        ) : isPlainRecord(value) ? (
          <div className="space-y-3">
            {Object.entries(value).map(([key, fieldValue]) => (
              <div className="grid gap-1" key={key}>
                <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                  {formatFieldName(key)}
                </div>
                <div className="min-w-0 rounded-sm text-foreground">
                  <ToolInputValue value={fieldValue} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ToolInputValue value={value} />
        )}
      </div>
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
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText && "bg-destructive/10 text-destructive"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
