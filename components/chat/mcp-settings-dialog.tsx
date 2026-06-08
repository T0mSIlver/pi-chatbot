"use client";

import { PlugIcon, SaveIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetcher } from "@/lib/utils";

type McpServerSummary = {
  id: string;
  transport: "stdio" | "http";
  label: string;
};

type CatalogResponse = {
  json: string;
  servers: McpServerSummary[];
};

type ProjectMcpServer = McpServerSummary & {
  enabled: boolean;
};

type ProjectMcpResponse = {
  servers: ProjectMcpServer[];
};

type ChatOverrideState = "inherit" | "enabled" | "disabled";

type ChatMcpServer = McpServerSummary & {
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  override: ChatOverrideState;
};

type ChatMcpResponse = {
  servers: ChatMcpServer[];
};

function endpoint(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

function TransportPill({ transport }: { transport: "stdio" | "http" }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
      {transport}
    </span>
  );
}

export function McpSettingsDialog({
  chatId,
  onOpenChange,
  open,
  projectId,
}: {
  chatId?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId?: string | null;
}) {
  const catalogKey = open ? endpoint("/api/mcp/config") : null;
  const projectKey =
    open && projectId ? endpoint(`/api/projects/${projectId}/mcp`) : null;
  const chatKey = open && chatId ? endpoint(`/api/chat/${chatId}/mcp`) : null;
  const { data: catalog, mutate: mutateCatalog } = useSWR<CatalogResponse>(
    catalogKey,
    fetcher,
    { revalidateOnFocus: false }
  );
  const { data: projectMcp, mutate: mutateProjectMcp } =
    useSWR<ProjectMcpResponse>(projectKey, fetcher, {
      revalidateOnFocus: false,
    });
  const { data: chatMcp, mutate: mutateChatMcp } = useSWR<ChatMcpResponse>(
    chatKey,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [draftJson, setDraftJson] = useState("");
  const [projectToggles, setProjectToggles] = useState<Record<string, boolean>>(
    {}
  );
  const [chatOverrides, setChatOverrides] = useState<
    Record<string, ChatOverrideState>
  >({});
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingChat, setIsSavingChat] = useState(false);

  useEffect(() => {
    if (catalog?.json) {
      setDraftJson(catalog.json);
    }
  }, [catalog?.json]);

  useEffect(() => {
    setProjectToggles(
      Object.fromEntries(
        (projectMcp?.servers ?? []).map((server) => [server.id, server.enabled])
      )
    );
  }, [projectMcp?.servers]);

  useEffect(() => {
    setChatOverrides(
      Object.fromEntries(
        (chatMcp?.servers ?? []).map((server) => [server.id, server.override])
      )
    );
  }, [chatMcp?.servers]);

  const parsedServerIds = useMemo(
    () => (catalog?.servers ?? []).map((server) => server.id).join(", "),
    [catalog?.servers]
  );

  const saveCatalog = async () => {
    setIsSavingCatalog(true);
    try {
      const response = await fetch(endpoint("/api/mcp/config"), {
        method: "PATCH",
        body: JSON.stringify({ json: draftJson }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.cause || result?.message || "Save failed");
      }

      await mutateCatalog(result, false);
      await Promise.all([mutateProjectMcp(), mutateChatMcp()]);
      toast.success("MCP catalog saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save MCP catalog."
      );
    } finally {
      setIsSavingCatalog(false);
    }
  };

  const saveProjectToggles = async () => {
    if (!projectId) {
      return;
    }

    setIsSavingProject(true);
    try {
      const response = await fetch(endpoint(`/api/projects/${projectId}/mcp`), {
        method: "PATCH",
        body: JSON.stringify({ servers: projectToggles }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.cause || result?.message || "Save failed");
      }

      await mutateProjectMcp(result, false);
      await mutateChatMcp();
      toast.success("Project MCP defaults saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save project MCP defaults."
      );
    } finally {
      setIsSavingProject(false);
    }
  };

  const saveChatOverrides = async () => {
    if (!chatId) {
      return;
    }

    setIsSavingChat(true);
    try {
      const response = await fetch(endpoint(`/api/chat/${chatId}/mcp`), {
        method: "PATCH",
        body: JSON.stringify({ overrides: chatOverrides }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.cause || result?.message || "Save failed");
      }

      await mutateChatMcp(result, false);
      toast.success("Conversation MCP overrides saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save conversation MCP overrides."
      );
    } finally {
      setIsSavingChat(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlugIcon className="size-4" />
            MCP
          </DialogTitle>
          <DialogDescription>
            Literal tokens are stored locally; prefer environment-variable
            references for secrets.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 gap-5 overflow-y-auto pr-1">
          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold">Catalog JSON</h3>
                <p className="truncate text-xs text-muted-foreground">
                  {parsedServerIds || "No parsed MCP servers"}
                </p>
              </div>
              <Button
                disabled={isSavingCatalog}
                onClick={saveCatalog}
                size="sm"
                type="button"
              >
                <SaveIcon className="size-4" />
                Save
              </Button>
            </div>
            <Textarea
              className="min-h-60 resize-y font-mono text-xs leading-5"
              data-testid="mcp-json-editor"
              onChange={(event) => setDraftJson(event.target.value)}
              spellCheck={false}
              value={draftJson}
            />
          </section>

          {projectId && (
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold">Project Defaults</h3>
                <Button
                  disabled={isSavingProject}
                  onClick={saveProjectToggles}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <SaveIcon className="size-4" />
                  Save
                </Button>
              </div>
              <div className="grid gap-1.5">
                {(projectMcp?.servers ?? catalog?.servers ?? []).map(
                  (server) => (
                    <label
                      className="flex min-h-10 items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                      key={server.id}
                    >
                      <input
                        checked={projectToggles[server.id] ?? false}
                        className="size-4"
                        onChange={(event) =>
                          setProjectToggles((current) => ({
                            ...current,
                            [server.id]: event.target.checked,
                          }))
                        }
                        type="checkbox"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {server.id}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {server.label}
                        </span>
                      </span>
                      <TransportPill transport={server.transport} />
                    </label>
                  )
                )}
              </div>
            </section>
          )}

          {chatId && (
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[13px] font-semibold">
                  Conversation Overrides
                </h3>
                <Button
                  disabled={isSavingChat}
                  onClick={saveChatOverrides}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <SaveIcon className="size-4" />
                  Save
                </Button>
              </div>
              <div className="grid gap-1.5">
                {(chatMcp?.servers ?? catalog?.servers ?? []).map((server) => (
                  <div
                    className="grid gap-2 rounded-lg border border-border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_180px]"
                    key={server.id}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {server.id}
                        </span>
                        <TransportPill transport={server.transport} />
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {server.label}
                      </div>
                    </div>
                    <Select
                      onValueChange={(value: ChatOverrideState) =>
                        setChatOverrides((current) => ({
                          ...current,
                          [server.id]: value,
                        }))
                      }
                      value={chatOverrides[server.id] ?? "inherit"}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Inherit project</SelectItem>
                        <SelectItem value="enabled">Force on</SelectItem>
                        <SelectItem value="disabled">Force off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
