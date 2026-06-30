"use client";

import { CopyIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  buildCopyPayload,
  parseInspectorRequest,
  parseInspectorResponse,
} from "@/lib/openai-inspect";
import type { ProviderCaptureRecord } from "@/lib/pi/provider-captures";
import { cn, fetcher } from "@/lib/utils";
import {
  RequestPanel,
  type ResponseMode,
  ResponsePanel,
} from "./provider-capture-views";
import { ProviderStatsToggle } from "./provider-stats-toggle";

type ProviderCapturesResponse = {
  captures: ProviderCaptureRecord[];
};

type ProviderCaptureDialogProps = {
  chatId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type CaptureTab = "request" | "response";

function formatCaptureTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusLabel(capture: ProviderCaptureRecord, recovered: boolean) {
  if (capture.error) {
    return recovered ? "Retried" : "Failed";
  }
  if (capture.response) {
    return String(capture.response.status);
  }
  return "Pending";
}

function statusVariant(capture: ProviderCaptureRecord, recovered: boolean) {
  if (capture.error) {
    return recovered ? ("outline" as const) : ("destructive" as const);
  }
  if (!capture.response) {
    return "outline" as const;
  }
  return capture.response.status >= 400 ? "destructive" : "secondary";
}

/**
 * The OpenAI client retries transient network failures, so an errored capture
 * is usually followed by a successful retry for the same assistant turn. We
 * flag those so the UI can present them as recovered rather than alarming
 * "errors" the user never saw in the chat.
 */
function isRecoveringSuccess(capture: ProviderCaptureRecord) {
  const { response } = capture;
  // A capture only proves the turn recovered if it actually produced a usable
  // response: a 2xx/3xx status AND a body we could read. A 200 that recorded
  // only `bodyReadError` (the stream dropped after headers) yielded no output,
  // so it must not mask an earlier genuine failure as "recovered".
  return Boolean(
    !capture.error &&
      response &&
      response.status < 400 &&
      !response.bodyReadError
  );
}

function computeRecoveredIds(captures: ProviderCaptureRecord[]) {
  const latestSuccessIndex = new Map<string, number>();
  for (const capture of captures) {
    if (isRecoveringSuccess(capture)) {
      const key = `${capture.assistantMessageId}|${capture.purpose}`;
      const previous = latestSuccessIndex.get(key) ?? Number.NEGATIVE_INFINITY;
      if (capture.requestIndex > previous) {
        latestSuccessIndex.set(key, capture.requestIndex);
      }
    }
  }

  const recovered = new Set<string>();
  for (const capture of captures) {
    if (!capture.error) {
      continue;
    }
    const key = `${capture.assistantMessageId}|${capture.purpose}`;
    const successIndex = latestSuccessIndex.get(key);
    if (successIndex !== undefined && successIndex > capture.requestIndex) {
      recovered.add(capture.id);
    }
  }
  return recovered;
}

export function ProviderCaptureDialog({
  chatId,
  open,
  onOpenChange,
}: ProviderCaptureDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CaptureTab>("request");
  const [responseMode, setResponseMode] = useState<ResponseMode>("collected");

  const { data, error, isLoading, mutate } = useSWR<ProviderCapturesResponse>(
    open
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat/${chatId}/provider-captures`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const captures = useMemo(() => data?.captures ?? [], [data]);
  const recoveredIds = useMemo(() => computeRecoveredIds(captures), [captures]);
  const selectedCapture = useMemo(
    () => captures.find((capture) => capture.id === selectedId) ?? captures[0],
    [captures, selectedId]
  );
  const parsedRequest = useMemo(
    () =>
      selectedCapture ? parseInspectorRequest(selectedCapture) : undefined,
    [selectedCapture]
  );
  const parsedResponse = useMemo(
    () =>
      selectedCapture ? parseInspectorResponse(selectedCapture) : undefined,
    [selectedCapture]
  );
  const selectedStats = selectedCapture?.stats;
  const canToggleResponseMode =
    activeTab === "response" && parsedResponse?.kind === "stream";

  useEffect(() => {
    if (captures.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !captures.some((capture) => capture.id === selectedId)) {
      setSelectedId(captures[0].id);
    }
  }, [captures, selectedId]);

  // Reset the response view to its default whenever a different capture is
  // inspected, so a "Chunks" choice on one capture doesn't leak into the next.
  useEffect(() => {
    setResponseMode("collected");
  }, [selectedCapture?.id]);

  const copySelected = useCallback(async () => {
    if (!selectedCapture) {
      return;
    }

    const text = buildCopyPayload(
      selectedCapture,
      { tab: activeTab, responseMode },
      parsedResponse
    );

    try {
      await copyTextToClipboard(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }, [activeTab, responseMode, selectedCapture, parsedResponse]);

  const downloadSelected = useCallback(() => {
    if (!selectedCapture) {
      return;
    }

    const blob = new Blob([JSON.stringify(selectedCapture, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `openai-payload-${selectedCapture.requestIndex}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [selectedCapture]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="grid h-[min(84vh,760px)] max-w-[min(96vw,1120px)] grid-rows-[auto_minmax(0,1fr)] gap-4 rounded-lg p-4 sm:max-w-[min(96vw,1120px)]"
        data-testid="provider-capture-dialog"
      >
        <DialogHeader className="pr-10">
          <DialogTitle>Inspect OpenAI Payload</DialogTitle>
          <DialogDescription className="sr-only">
            Actual provider requests and responses captured for this
            conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-hidden rounded-md border border-border bg-muted/20">
            <div className="flex h-10 items-center justify-between border-border border-b px-3">
              <div className="font-medium text-muted-foreground text-xs">
                Captures
              </div>
              <Button
                aria-label="Refresh captures"
                onClick={() => mutate()}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <RefreshCwIcon className="size-3.5" />
              </Button>
            </div>
            <ScrollArea className="h-[calc(100%-2.5rem)]">
              {isLoading ? (
                <div className="p-3 text-muted-foreground text-sm">
                  Loading captures...
                </div>
              ) : error ? (
                <div className="p-3 text-destructive text-sm">
                  Couldn&apos;t load captures.
                </div>
              ) : captures.length === 0 ? (
                <div
                  className="p-3 text-muted-foreground text-sm"
                  data-testid="provider-capture-empty"
                >
                  No provider captures recorded for this conversation yet.
                </div>
              ) : (
                <div className="flex flex-col">
                  {captures.map((capture) => {
                    const recovered = recoveredIds.has(capture.id);
                    return (
                      <button
                        className={cn(
                          "flex min-h-16 w-full flex-col gap-1 border-border border-b px-3 py-2 text-left transition-colors hover:bg-muted/50",
                          selectedCapture?.id === capture.id && "bg-muted"
                        )}
                        data-testid="provider-capture-list-item"
                        key={capture.id}
                        onClick={() => setSelectedId(capture.id)}
                        type="button"
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-xs">
                            Request {capture.requestIndex}
                          </span>
                          <Badge
                            className="h-4 rounded px-1.5 text-[10px]"
                            variant={statusVariant(capture, recovered)}
                          >
                            {statusLabel(capture, recovered)}
                          </Badge>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="truncate">{capture.model}</span>
                          <span aria-hidden="true">/</span>
                          <span>{capture.purpose}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatCaptureTime(capture.createdAt)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-border">
            <div className="flex min-h-10 flex-wrap items-center gap-2 border-border border-b px-3 py-2">
              <div className="flex rounded-md border border-border bg-muted/30 p-0.5">
                {(["request", "response"] as const).map((tab) => (
                  <button
                    className={cn(
                      "h-7 rounded px-3 font-medium text-xs capitalize transition-colors",
                      activeTab === tab
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    data-testid={`provider-capture-${tab}-tab`}
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    type="button"
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {canToggleResponseMode && (
                <div className="flex rounded-md border border-border bg-muted/30 p-0.5">
                  {(
                    [
                      ["collected", "Collected"],
                      ["stream", "Chunks"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      className={cn(
                        "h-7 rounded px-3 font-medium text-xs transition-colors",
                        responseMode === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      data-testid={`provider-capture-response-mode-${value}`}
                      key={value}
                      onClick={() => setResponseMode(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                {selectedStats && (
                  <ProviderStatsToggle className="mr-2" stats={selectedStats} />
                )}
                <Button
                  disabled={!selectedCapture}
                  onClick={copySelected}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <CopyIcon className="size-3.5" />
                  Copy
                </Button>
                <Button
                  disabled={!selectedCapture}
                  onClick={downloadSelected}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <DownloadIcon className="size-3.5" />
                  Download
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0">
              {selectedCapture && parsedRequest && parsedResponse ? (
                <div
                  data-testid={`provider-capture-${activeTab}`}
                  key={`${selectedCapture.id}-${activeTab}`}
                >
                  {activeTab === "request" ? (
                    <RequestPanel request={parsedRequest} />
                  ) : (
                    <ResponsePanel
                      mode={responseMode}
                      recovered={recoveredIds.has(selectedCapture.id)}
                      response={parsedResponse}
                    />
                  )}
                </div>
              ) : (
                <div className="p-3 text-muted-foreground text-sm">
                  Select a capture to inspect.
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
