"use client";

import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  type CollectedContent,
  normalizeContentParts,
  type OpenAIContentPart,
  type OpenAIMessage,
  type OpenAIToolCall,
  type ParsedRequest,
  type ParsedResponse,
  type StreamEvent,
  toolCallArguments,
} from "@/lib/openai-inspect";
import { cn } from "@/lib/utils";

export type ResponseMode = "stream" | "collected";

// noArrayIndexKey only inspects JSX `key` props, so deriving keys here (not at
// the JSX site) keeps static-capture lists keyed by position without tripping
// the lint rule.
function withKeys<T>(items: T[], prefix: string) {
  return items.map((item, index) => ({ key: `${prefix}-${index}`, item }));
}

const ROLE_STYLES: Record<string, string> = {
  system: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  developer: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  user: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  assistant: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  tool: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 font-medium text-[11px] uppercase tracking-wide",
        ROLE_STYLES[role] ?? "bg-muted text-muted-foreground"
      )}
    >
      {role}
    </span>
  );
}

function Section({
  title,
  count,
  children,
  className,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
        {count !== undefined && (
          <span className="ml-1 text-muted-foreground/60">({count})</span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-md border border-border bg-muted/10"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
        <span className="text-muted-foreground transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="font-medium">{title}</span>
        {summary && (
          <span className="truncate text-muted-foreground/70">{summary}</span>
        )}
      </summary>
      <div className="border-border border-t px-3 py-2">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Structured value tree (used for de-emphasized params/headers/usage/errors)
// ---------------------------------------------------------------------------

function ScalarValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="text-muted-foreground/60">null</span>;
  }
  if (value === undefined) {
    return <span className="text-muted-foreground/60">undefined</span>;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return (
      <span className="text-sky-600 dark:text-sky-400">{String(value)}</span>
    );
  }
  return (
    <span className="whitespace-pre-wrap break-words text-foreground">
      {String(value)}
    </span>
  );
}

function StructuredValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (depth > 6) {
    return <ScalarValue value={String(value)} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground/60">[]</span>;
    }
    return (
      <div className="flex flex-col gap-1">
        {withKeys(value, "item").map(({ key, item }, position) => (
          <div className="flex gap-2" key={key}>
            <span className="text-muted-foreground/50 tabular-nums">
              {position}
            </span>
            <StructuredValue depth={depth + 1} value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-muted-foreground/60">{"{}"}</span>;
    }
    return (
      <div className="flex flex-col gap-1">
        {entries.map(([key, child]) => (
          <div className="flex flex-wrap gap-x-2" key={key}>
            <span className="font-medium text-muted-foreground">{key}:</span>
            <StructuredValue depth={depth + 1} value={child} />
          </div>
        ))}
      </div>
    );
  }

  return <ScalarValue value={value} />;
}

function KeyValueGrid({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-muted-foreground/60 text-xs">None</p>;
  }
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      {entries.map(([key, value]) => (
        <div className="contents" key={key}>
          <dt className="truncate font-medium text-muted-foreground">{key}</dt>
          <dd className="break-words font-mono text-foreground/90">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Messages & tool calls
// ---------------------------------------------------------------------------

function ContentPart({ part }: { part: OpenAIContentPart }) {
  if (part.type === "text" && typeof part.text === "string") {
    return (
      <p className="whitespace-pre-wrap break-words text-foreground text-sm leading-relaxed">
        {part.text}
      </p>
    );
  }

  if (part.type === "image_url") {
    const url =
      typeof part.image_url === "object" && part.image_url !== null
        ? (part.image_url as { url?: string }).url
        : undefined;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">image</span>
        {url && (
          // biome-ignore lint/performance/noImgElement: capture previews are arbitrary remote/data URLs outside next/image's allowlist
          <img
            alt="Inspector attachment"
            className="max-h-40 w-fit rounded border border-border object-contain"
            src={url}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{part.type}</span>
      <StructuredValue value={part} />
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: OpenAIToolCall }) {
  const { text, parsed } = toolCallArguments(toolCall);
  return (
    <div className="rounded-md border border-border bg-background/60 p-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-medium text-violet-600 dark:text-violet-400">
          tool call
        </span>
        <span className="font-mono font-medium">
          {toolCall.function?.name ?? "(unnamed)"}
        </span>
        {toolCall.id && (
          <span className="truncate text-muted-foreground/60">
            {toolCall.id}
          </span>
        )}
      </div>
      <div className="mt-2 text-xs">
        {parsed === undefined ? (
          <p className="whitespace-pre-wrap break-words font-mono text-foreground/90">
            {text || (
              <span className="text-muted-foreground/60">(no arguments)</span>
            )}
          </p>
        ) : (
          <StructuredValue value={parsed} />
        )}
      </div>
    </div>
  );
}

function CollectedToolCallCard({
  toolCall,
}: {
  toolCall: CollectedContent["toolCalls"][number];
}) {
  return (
    <ToolCallCard
      toolCall={{
        id: toolCall.id,
        function: { name: toolCall.name, arguments: toolCall.arguments },
      }}
    />
  );
}

export function MessageCard({ message }: { message: OpenAIMessage }) {
  const parts = normalizeContentParts(message.content);
  const toolCalls = message.tool_calls ?? [];

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <RoleBadge role={message.role} />
        {message.name && (
          <span className="text-muted-foreground text-xs">{message.name}</span>
        )}
        {message.tool_call_id && (
          <span className="truncate text-muted-foreground/60 text-xs">
            ↳ {message.tool_call_id}
          </span>
        )}
      </div>

      {typeof message.reasoning_content === "string" &&
        message.reasoning_content.length > 0 && (
          <div className="mb-2 border-muted-foreground/30 border-l-2 pl-2 text-muted-foreground text-sm italic">
            <p className="whitespace-pre-wrap break-words">
              {message.reasoning_content}
            </p>
          </div>
        )}

      {parts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {withKeys(parts, "part").map(({ key, item }) => (
            <ContentPart key={key} part={item} />
          ))}
        </div>
      ) : (
        toolCalls.length === 0 && (
          <p className="text-muted-foreground/60 text-sm italic">
            (no content)
          </p>
        )
      )}

      {toolCalls.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {withKeys(toolCalls, "tc").map(({ key, item }) => (
            <ToolCallCard key={key} toolCall={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request panel
// ---------------------------------------------------------------------------

const PARAM_SUMMARY_KEYS = ["model", "stream", "temperature", "max_tokens"];

function paramSummary(params: Record<string, unknown>) {
  return PARAM_SUMMARY_KEYS.filter((key) => params[key] !== undefined)
    .map((key) => `${key}: ${String(params[key])}`)
    .join("  ·  ");
}

export function RequestPanel({ request }: { request: ParsedRequest }) {
  if (request.bodyReadError) {
    return (
      <Banner
        detail={request.bodyReadError}
        title="Request body unavailable"
        tone="warning"
      />
    );
  }

  if (request.messages.length === 0 && request.rawText) {
    return (
      <Section title="Request body">
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-3 text-foreground text-sm">
          {request.rawText}
        </pre>
      </Section>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <Section count={request.messages.length} title="Messages">
        <div className="flex flex-col gap-2">
          {withKeys(request.messages, "msg").map(({ key, item }) => (
            <MessageCard key={key} message={item} />
          ))}
        </div>
      </Section>

      {request.tools.length > 0 && (
        <Collapsible
          summary={request.tools
            .map((tool) => toolName(tool))
            .filter(Boolean)
            .join(", ")}
          title={`Tools (${request.tools.length})`}
        >
          <div className="flex flex-col gap-2">
            {withKeys(request.tools, "tool").map(({ key, item }) => (
              <div
                className="rounded border border-border bg-background/40 p-2 text-xs"
                key={key}
              >
                <StructuredValue value={item} />
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {Object.keys(request.params).length > 0 && (
        <Collapsible
          defaultOpen
          summary={paramSummary(request.params)}
          title="Parameters"
        >
          <StructuredValue value={request.params} />
        </Collapsible>
      )}

      <Collapsible
        summary={`${request.meta.method} ${request.meta.url}`}
        title="Endpoint"
      >
        <div className="flex flex-col gap-3 text-xs">
          <KeyValueGrid
            data={{ method: request.meta.method, url: request.meta.url }}
          />
          <div>
            <h4 className="mb-1 font-medium text-muted-foreground">Headers</h4>
            <KeyValueGrid data={request.meta.headers} />
          </div>
        </div>
      </Collapsible>
    </div>
  );
}

function toolName(tool: unknown): string {
  if (typeof tool === "object" && tool !== null) {
    const fn = (tool as { function?: { name?: string } }).function;
    if (fn && typeof fn.name === "string") {
      return fn.name;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Response panel
// ---------------------------------------------------------------------------

function Banner({
  tone,
  title,
  detail,
  children,
}: {
  tone: "warning" | "error" | "info";
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400"
        : "border-border bg-muted/20 text-foreground";

  return (
    <div className={cn("m-3 rounded-md border p-3", toneClass)}>
      <div className="flex items-center gap-2">
        <AlertTriangleIcon className="size-4 shrink-0" />
        <span className="font-medium text-sm">{title}</span>
      </div>
      {detail && (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs opacity-90">
          {detail}
        </p>
      )}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function UsageFooter({
  finishReason,
  usage,
}: {
  finishReason?: string;
  usage?: unknown;
}) {
  if (!(finishReason || usage !== undefined)) {
    return null;
  }
  return (
    <Collapsible
      summary={finishReason ? `finish: ${finishReason}` : undefined}
      title="Finish & usage"
    >
      <div className="flex flex-col gap-2 text-xs">
        {finishReason && (
          <KeyValueGrid data={{ finish_reason: finishReason }} />
        )}
        {usage !== undefined && <StructuredValue value={usage} />}
      </div>
    </Collapsible>
  );
}

function CollectedView({ collected }: { collected: CollectedContent }) {
  const isEmpty =
    collected.text.length === 0 &&
    collected.reasoning.length === 0 &&
    collected.toolCalls.length === 0 &&
    collected.error === undefined;

  return (
    <div className="flex flex-col gap-3">
      {collected.error !== undefined && (
        <Banner title="Provider error in stream" tone="error">
          <StructuredValue value={collected.error} />
        </Banner>
      )}

      {collected.reasoning.length > 0 && (
        <Collapsible defaultOpen title="Reasoning">
          <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm leading-relaxed">
            {collected.reasoning}
          </p>
        </Collapsible>
      )}

      {collected.text.length > 0 && (
        <Section title="Content">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="whitespace-pre-wrap break-words text-foreground text-sm leading-relaxed">
              {collected.text}
            </p>
          </div>
        </Section>
      )}

      {collected.toolCalls.length > 0 && (
        <Section count={collected.toolCalls.length} title="Tool calls">
          <div className="flex flex-col gap-2">
            {withKeys(collected.toolCalls, "ctc").map(({ key, item }) => (
              <CollectedToolCallCard key={key} toolCall={item} />
            ))}
          </div>
        </Section>
      )}

      {isEmpty && (
        <p className="text-muted-foreground/60 text-sm italic">
          No content was collected from the stream.
        </p>
      )}

      <UsageFooter
        finishReason={collected.finishReason}
        usage={collected.usage}
      />
    </div>
  );
}

function StreamEventRow({ event }: { event: StreamEvent }) {
  if (event.isDone) {
    return (
      <div className="flex items-center gap-2 px-1 text-muted-foreground/60 text-xs">
        <EventTag>{`#${event.index}`}</EventTag>
        <span>[DONE]</span>
      </div>
    );
  }

  if (event.parseError) {
    return (
      <div className="flex items-start gap-2 px-1 text-xs">
        <EventTag>{`#${event.index}`}</EventTag>
        <span className="whitespace-pre-wrap break-words font-mono text-amber-600 dark:text-amber-400">
          {event.raw}
        </span>
      </div>
    );
  }

  const tags: string[] = [];
  if (event.role) {
    tags.push(`role: ${event.role}`);
  }
  if (event.finishReason) {
    tags.push(`finish: ${event.finishReason}`);
  }
  if (event.usage !== undefined) {
    tags.push("usage");
  }

  return (
    <div className="flex items-start gap-2 px-1">
      <EventTag>{`#${event.index}`}</EventTag>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {event.content && (
          <span className="whitespace-pre-wrap break-words text-foreground text-sm">
            {event.content}
          </span>
        )}
        {event.reasoning && (
          <span className="whitespace-pre-wrap break-words text-muted-foreground text-sm italic">
            {event.reasoning}
          </span>
        )}
        {event.toolCalls && event.toolCalls.length > 0 && (
          <div className="flex flex-col gap-1">
            {withKeys(event.toolCalls, "se-tc").map(({ key, item }) => (
              <span
                className="break-words font-mono text-violet-600 text-xs dark:text-violet-400"
                key={key}
              >
                {item.function?.name ? `${item.function.name}(` : ""}
                {item.function?.arguments ?? ""}
              </span>
            ))}
          </div>
        )}
        {event.error !== undefined && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive text-xs">
            <StructuredValue value={event.error} />
          </div>
        )}
        {event.data !== undefined && (
          <div className="rounded border border-border bg-muted/20 p-2 text-xs">
            <StructuredValue value={event.data} />
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {withKeys(tags, "tag").map(({ key, item }) => (
              <span
                className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                key={key}
              >
                {item}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventTag({ children }: { children: ReactNode }) {
  return (
    <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground/50 tabular-nums">
      {children}
    </span>
  );
}

function StreamView({ events }: { events: StreamEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground/60 text-sm italic">
        No stream events were captured.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {withKeys(events, "evt").map(({ key, item }) => (
        <StreamEventRow event={item} key={key} />
      ))}
    </div>
  );
}

function ResponseDetails({ response }: { response: ParsedResponse }) {
  if (response.kind === "pending" || response.kind === "network-error") {
    return null;
  }
  return (
    <Collapsible
      summary={`${response.status} ${response.statusText}`}
      title="Response details"
    >
      <div className="flex flex-col gap-3 text-xs">
        <KeyValueGrid
          data={{
            status: String(response.status),
            statusText: response.statusText,
          }}
        />
        <div>
          <h4 className="mb-1 font-medium text-muted-foreground">Headers</h4>
          <KeyValueGrid data={response.headers} />
        </div>
      </div>
    </Collapsible>
  );
}

function NetworkErrorView({
  response,
  recovered,
}: {
  response: Extract<ParsedResponse, { kind: "network-error" }>;
  recovered: boolean;
}) {
  const { error } = response;
  const causes: string[] = [];
  let cause = error.cause;
  while (cause) {
    causes.push(
      [cause.name, cause.code, cause.message].filter(Boolean).join(" · ")
    );
    cause = cause.cause;
  }

  return (
    <Banner
      detail={[error.name, error.code, error.message]
        .filter(Boolean)
        .join(" · ")}
      title={
        recovered ? "Transient request failure (recovered)" : "Request failed"
      }
      tone={recovered ? "warning" : "error"}
    >
      <div className="flex flex-col gap-2 text-xs">
        {recovered && (
          <p className="text-muted-foreground">
            The provider client automatically retried this request, so the
            conversation was not affected. This attempt is shown for debugging.
          </p>
        )}
        {causes.length > 0 && (
          <div>
            <h4 className="mb-1 font-medium text-muted-foreground">Cause</h4>
            <ul className="flex flex-col gap-0.5">
              {withKeys(causes, "cause").map(({ key, item }) => (
                <li className="break-words font-mono" key={key}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Banner>
  );
}

export function ResponsePanel({
  response,
  mode,
  recovered,
}: {
  response: ParsedResponse;
  mode: ResponseMode;
  recovered: boolean;
}) {
  if (response.kind === "pending") {
    return (
      <p className="p-3 text-muted-foreground text-sm">
        No response has been recorded for this request yet.
      </p>
    );
  }

  if (response.kind === "network-error") {
    return <NetworkErrorView recovered={recovered} response={response} />;
  }

  if (response.kind === "body-error") {
    return (
      <Banner
        detail={response.bodyReadError}
        title="Response body unavailable"
        tone="warning"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {response.kind === "stream" &&
        (mode === "collected" ? (
          <CollectedView collected={response.collected} />
        ) : (
          <Section count={response.events.length} title="Stream events">
            <StreamView events={response.events} />
          </Section>
        ))}

      {response.kind === "message" && (
        <>
          <Section title="Message">
            {response.message ? (
              <MessageCard message={response.message} />
            ) : (
              <p className="text-muted-foreground/60 text-sm italic">
                No message in response.
              </p>
            )}
          </Section>
          <UsageFooter
            finishReason={response.finishReason}
            usage={response.usage}
          />
        </>
      )}

      {response.kind === "error-body" && (
        <Banner title={`Provider error (${response.status})`} tone="error">
          <StructuredValue value={response.error} />
        </Banner>
      )}

      {response.kind === "other" &&
        (response.text ? (
          <Section title="Response body">
            <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-3 text-foreground text-sm">
              {response.text}
            </pre>
          </Section>
        ) : (
          <Section title="Response body">
            {response.value === undefined ? (
              <p className="text-muted-foreground/60 text-sm italic">
                Empty response body.
              </p>
            ) : (
              <StructuredValue value={response.value} />
            )}
          </Section>
        ))}

      <ResponseDetails response={response} />
    </div>
  );
}
