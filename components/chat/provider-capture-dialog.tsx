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
import type { ProviderCaptureRecord } from "@/lib/pi/provider-captures";
import { cn, fetcher } from "@/lib/utils";

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

function statusLabel(capture: ProviderCaptureRecord) {
  if (capture.error) {
    return "Error";
  }
  if (capture.response) {
    return String(capture.response.status);
  }
  return "Pending";
}

function statusVariant(capture: ProviderCaptureRecord) {
  if (capture.error) {
    return "destructive" as const;
  }
  if (!capture.response) {
    return "outline" as const;
  }
  return capture.response.status >= 400 ? "destructive" : "secondary";
}

function jsonForTab(
  capture: ProviderCaptureRecord | undefined,
  tab: CaptureTab
) {
  if (!capture) {
    return "";
  }

  if (tab === "request") {
    return JSON.stringify(capture.request, null, 2);
  }

  return JSON.stringify(
    capture.response ?? capture.error ?? "No response recorded yet.",
    null,
    2
  );
}

export function ProviderCaptureDialog({
  chatId,
  open,
  onOpenChange,
}: ProviderCaptureDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CaptureTab>("request");

  const { data, error, isLoading, mutate } = useSWR<ProviderCapturesResponse>(
    open
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat/${chatId}/provider-captures`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const captures = data?.captures ?? [];
  const selectedCapture = useMemo(
    () => captures.find((capture) => capture.id === selectedId) ?? captures[0],
    [captures, selectedId]
  );
  const selectedJson = useMemo(
    () => jsonForTab(selectedCapture, activeTab),
    [activeTab, selectedCapture]
  );

  useEffect(() => {
    if (captures.length === 0) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !captures.some((capture) => capture.id === selectedId)) {
      setSelectedId(captures[0].id);
    }
  }, [captures, selectedId]);

  const copySelected = useCallback(async () => {
    if (!selectedJson) {
      return;
    }

    await navigator.clipboard.writeText(selectedJson);
    toast.success("Copied payload");
  }, [selectedJson]);

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
            <div className="flex h-10 items-center justify-between border-b border-border px-3">
              <div className="text-xs font-medium text-muted-foreground">
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
                <div className="p-3 text-sm text-muted-foreground">
                  Loading captures...
                </div>
              ) : error ? (
                <div className="p-3 text-sm text-destructive">
                  Couldn&apos;t load captures.
                </div>
              ) : captures.length === 0 ? (
                <div
                  className="p-3 text-sm text-muted-foreground"
                  data-testid="provider-capture-empty"
                >
                  No provider captures recorded for this conversation yet.
                </div>
              ) : (
                <div className="flex flex-col">
                  {captures.map((capture) => (
                    <button
                      className={cn(
                        "flex min-h-16 w-full flex-col gap-1 border-b border-border px-3 py-2 text-left transition-colors hover:bg-muted/50",
                        selectedCapture?.id === capture.id && "bg-muted"
                      )}
                      data-testid="provider-capture-list-item"
                      key={capture.id}
                      onClick={() => setSelectedId(capture.id)}
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium">
                          Request {capture.requestIndex}
                        </span>
                        <Badge
                          className="h-4 rounded px-1.5 text-[10px]"
                          variant={statusVariant(capture)}
                        >
                          {statusLabel(capture)}
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
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-md border border-border">
            <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <div className="flex rounded-md border border-border bg-muted/30 p-0.5">
                {(["request", "response"] as const).map((tab) => (
                  <button
                    className={cn(
                      "h-7 rounded px-3 text-xs font-medium capitalize transition-colors",
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

              <div className="ml-auto flex items-center gap-1">
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
              {selectedCapture ? (
                <pre
                  className="min-h-full whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed"
                  data-testid="provider-capture-json"
                >
                  {selectedJson}
                </pre>
              ) : (
                <div className="p-3 text-sm text-muted-foreground">
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
