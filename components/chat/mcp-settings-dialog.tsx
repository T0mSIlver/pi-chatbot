"use client";

import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  Clock3Icon,
  LinkIcon,
  PlusIcon,
  PlugIcon,
  RefreshCwIcon,
  SaveIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, fetcher } from "@/lib/utils";

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

type AddServerMode = "command" | "url";
type Lifecycle = "lazy" | "eager" | "keep-alive";
type AuthMode = "none" | "bearer" | "oauth";

type McpConnectionState =
  | "checking"
  | "connected"
  | "needs-auth"
  | "timeout"
  | "error"
  | "not-tested";

type EnablementSource =
  | "catalog-only"
  | "conversation-disabled"
  | "conversation-enabled"
  | "not-enabled"
  | "project-enabled";

type McpStatusServer = McpServerSummary & {
  checkedAt: string;
  connectionState: McpConnectionState;
  enabled: boolean;
  effectiveEnabled: boolean;
  enablementSource: EnablementSource;
  latencyMs?: number;
  message?: string;
};

type KeyValueRow = {
  key: string;
  value: string;
};

function endpoint(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

function rowsToRecord(rows: KeyValueRow[]) {
  return Object.fromEntries(
    rows
      .map((row) => [row.key.trim(), row.value] as const)
      .filter(([key]) => key.length > 0)
  );
}

function connectionLabel(state: McpConnectionState) {
  switch (state) {
    case "checking":
      return "Checking";
    case "connected":
      return "Connected";
    case "needs-auth":
      return "Needs auth";
    case "timeout":
      return "Timeout";
    case "error":
      return "Error";
    case "not-tested":
      return "Not tested";
  }
}

function enablementLabel(source: EnablementSource) {
  switch (source) {
    case "conversation-enabled":
      return "Forced on";
    case "conversation-disabled":
      return "Forced off";
    case "project-enabled":
      return "Enabled by project";
    case "catalog-only":
      return "Catalog only";
    case "not-enabled":
      return "Not enabled";
  }
}

function TransportPill({ transport }: { transport: "stdio" | "http" }) {
  return (
    <Badge className="rounded-md text-[10px] uppercase" variant="outline">
      {transport}
    </Badge>
  );
}

function ConnectionBadge({ state }: { state: McpConnectionState }) {
  const Icon =
    state === "connected"
      ? CheckCircle2Icon
      : state === "checking"
        ? RefreshCwIcon
        : state === "not-tested"
          ? CircleDashedIcon
          : state === "timeout"
            ? Clock3Icon
            : CircleAlertIcon;

  return (
    <Badge
      className={cn(
        "gap-1 rounded-md",
        state === "connected" &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        (state === "error" || state === "timeout") &&
          "border-destructive/25 bg-destructive/10 text-destructive",
        state === "needs-auth" &&
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        state === "checking" && "text-muted-foreground"
      )}
      variant="outline"
    >
      <Icon className={cn("size-3", state === "checking" && "animate-spin")} />
      {connectionLabel(state)}
    </Badge>
  );
}

function EnablementBadge({ source }: { source: EnablementSource }) {
  return (
    <Badge
      className={cn(
        "rounded-md",
        source === "project-enabled" &&
          "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        source === "conversation-enabled" &&
          "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        source === "conversation-disabled" &&
          "border-destructive/25 bg-destructive/10 text-destructive"
      )}
      variant="outline"
    >
      {enablementLabel(source)}
    </Badge>
  );
}

function ScopeCopy({
  chatId,
  projectId,
}: {
  chatId?: string;
  projectId?: string | null;
}) {
  if (projectId) {
    return (
      <p className="text-xs text-muted-foreground">
        Project defaults apply to every conversation in this project. Saved
        conversations can still force individual servers on or off.
      </p>
    );
  }

  if (chatId) {
    return (
      <p className="text-xs text-muted-foreground">
        Standalone conversations do not have project defaults. This saved
        conversation can use overrides, but new standalone chats only edit the
        catalog until they are saved.
      </p>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Standalone new chats do not enable MCP servers by project. Add servers to
      the catalog here, then enable them from a project or a saved conversation.
    </p>
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
  const [statusById, setStatusById] = useState<
    Record<string, Partial<McpStatusServer> & { connectionState: McpConnectionState }>
  >({});
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isSavingChat, setIsSavingChat] = useState(false);
  const [addMode, setAddMode] = useState<AddServerMode>("command");
  const [serverId, setServerId] = useState("");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [cwd, setCwd] = useState("");
  const [lifecycle, setLifecycle] = useState<Lifecycle>("lazy");
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [bearerTokenEnv, setBearerTokenEnv] = useState("");
  const [envRows, setEnvRows] = useState<KeyValueRow[]>([]);
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>([]);

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

  const catalogServers = catalog?.servers ?? [];
  const serverIdsKey = useMemo(
    () => catalogServers.map((server) => server.id).join("\u0000"),
    [catalogServers]
  );
  const parsedServerIds = useMemo(
    () => catalogServers.map((server) => server.id).join(", "),
    [catalogServers]
  );

  const refreshStatuses = useCallback(
    async (serverIds?: string[]) => {
      const ids = serverIds ?? catalogServers.map((server) => server.id);
      if (!(open && catalog) || ids.length === 0) {
        setStatusById({});
        return;
      }

      setIsCheckingStatus(true);
      setStatusById((current) => ({
        ...current,
        ...Object.fromEntries(
          ids.map((id) => [id, { connectionState: "checking" as const }])
        ),
      }));

      try {
        const response = await fetch(endpoint("/api/mcp/status"), {
          method: "POST",
          body: JSON.stringify({
            chatId,
            projectId,
            serverIds: ids,
          }),
        });
        const result = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(result?.cause || result?.message || "Status failed");
        }

        setStatusById(
          Object.fromEntries(
            (result?.servers ?? []).map((server: McpStatusServer) => [
              server.id,
              server,
            ])
          )
        );
      } catch (error) {
        setStatusById((current) => ({
          ...current,
          ...Object.fromEntries(
            ids.map((id) => [
              id,
              {
                connectionState: "error" as const,
                message:
                  error instanceof Error ? error.message : "Status check failed",
              },
            ])
          ),
        }));
      } finally {
        setIsCheckingStatus(false);
      }
    },
    [catalog, catalogServers, chatId, open, projectId]
  );

  useEffect(() => {
    if (open && catalog) {
      void refreshStatuses();
    }
  }, [catalog, open, refreshStatuses, serverIdsKey]);

  const statusValues = Object.values(statusById);
  const connectedCount = statusValues.filter(
    (server) => server.connectionState === "connected"
  ).length;
  const enabledCount = statusValues.filter(
    (server) => server.effectiveEnabled
  ).length;

  const resetAddForm = () => {
    setServerId("");
    setCommand("");
    setUrl("");
    setCwd("");
    setLifecycle("lazy");
    setAuthMode("none");
    setBearerTokenEnv("");
    setEnvRows([]);
    setHeaderRows([]);
  };

  const addServer = async () => {
    setIsAddingServer(true);
    try {
      const response = await fetch(endpoint("/api/mcp/config/servers"), {
        method: "POST",
        body: JSON.stringify(
          addMode === "command"
            ? {
                command,
                cwd,
                env: rowsToRecord(envRows),
                id: serverId,
                lifecycle,
                mode: "command",
              }
            : {
                auth: authMode,
                bearerTokenEnv,
                headers: rowsToRecord(headerRows),
                id: serverId,
                lifecycle,
                mode: "url",
                url,
              }
        ),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.cause || result?.message || "Add failed");
      }

      await mutateCatalog(result, false);
      await Promise.all([mutateProjectMcp(), mutateChatMcp()]);
      resetAddForm();
      toast.success("MCP server added");
      await refreshStatuses(result.servers.map((server: McpServerSummary) => server.id));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add MCP server."
      );
    } finally {
      setIsAddingServer(false);
    }
  };

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
      await refreshStatuses(result.servers.map((server: McpServerSummary) => server.id));
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
      await refreshStatuses();
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
      await refreshStatuses();
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

  const updateRow = (
    rows: KeyValueRow[],
    setRows: (rows: KeyValueRow[]) => void,
    index: number,
    field: keyof KeyValueRow,
    value: string
  ) => {
    setRows(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      )
    );
  };

  const serverRows = catalogServers.map((server) => {
    const status = statusById[server.id];
    const fallbackSource: EnablementSource = projectId
      ? projectToggles[server.id]
        ? "project-enabled"
        : "not-enabled"
      : "catalog-only";

    return {
      ...server,
      checkedAt: status?.checkedAt,
      connectionState: status?.connectionState ?? "not-tested",
      effectiveEnabled: status?.effectiveEnabled ?? false,
      enablementSource: status?.enablementSource ?? fallbackSource,
      latencyMs: status?.latencyMs,
      message: status?.message,
    };
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlugIcon className="size-4" />
            MCP Servers
          </DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 gap-5 overflow-y-auto pr-1">
          <section className="grid gap-3">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{catalogServers.length} configured</Badge>
                  <Badge variant="outline">{connectedCount} connected</Badge>
                  <Badge variant="outline">{enabledCount} enabled here</Badge>
                </div>
                <ScopeCopy chatId={chatId} projectId={projectId} />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label="Refresh MCP connection status"
                    disabled={isCheckingStatus || catalogServers.length === 0}
                    onClick={() => refreshStatuses()}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <RefreshCwIcon
                      className={cn("size-4", isCheckingStatus && "animate-spin")}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh MCP connection status</TooltipContent>
              </Tooltip>
            </div>
          </section>

          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold">Add Server</h3>
                <p className="text-xs text-muted-foreground">
                  Add a command or URL server without editing raw JSON.
                </p>
              </div>
              <ButtonGroup>
                <Button
                  onClick={() => setAddMode("command")}
                  size="sm"
                  type="button"
                  variant={addMode === "command" ? "secondary" : "outline"}
                >
                  <TerminalSquareIcon className="size-4" />
                  Command
                </Button>
                <Button
                  onClick={() => setAddMode("url")}
                  size="sm"
                  type="button"
                  variant={addMode === "url" ? "secondary" : "outline"}
                >
                  <LinkIcon className="size-4" />
                  URL
                </Button>
              </ButtonGroup>
            </div>

            <div className="grid gap-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                <div className="grid gap-1.5">
                  <Label htmlFor="mcp-server-id">Server id</Label>
                  <Input
                    id="mcp-server-id"
                    onChange={(event) => setServerId(event.target.value)}
                    placeholder="github"
                    value={serverId}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Lifecycle</Label>
                  <Select
                    onValueChange={(value: Lifecycle) => setLifecycle(value)}
                    value={lifecycle}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lazy">Lazy</SelectItem>
                      <SelectItem value="eager">Eager</SelectItem>
                      <SelectItem value="keep-alive">Keep alive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {addMode === "command" ? (
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-command">Command</Label>
                    <Input
                      id="mcp-command"
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder="GITHUB_TOKEN=${GITHUB_TOKEN} npx -y @modelcontextprotocol/server-github"
                      value={command}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-cwd">Working directory</Label>
                    <Input
                      id="mcp-cwd"
                      onChange={(event) => setCwd(event.target.value)}
                      placeholder="Optional"
                      value={cwd}
                    />
                  </div>
                  <KeyValueRows
                    label="Environment"
                    onAdd={() => setEnvRows([...envRows, { key: "", value: "" }])}
                    onRemove={(index) =>
                      setEnvRows(envRows.filter((_, rowIndex) => rowIndex !== index))
                    }
                    onUpdate={(index, field, value) =>
                      updateRow(envRows, setEnvRows, index, field, value)
                    }
                    rows={envRows}
                  />
                </div>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="mcp-url">URL</Label>
                    <Input
                      id="mcp-url"
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://example.com/mcp"
                      value={url}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                    <div className="grid gap-1.5">
                      <Label>Auth</Label>
                      <Select
                        onValueChange={(value: AuthMode) => setAuthMode(value)}
                        value={authMode}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="bearer">Bearer</SelectItem>
                          <SelectItem value="oauth">OAuth</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="mcp-bearer-env">Bearer env var</Label>
                      <Input
                        disabled={authMode !== "bearer"}
                        id="mcp-bearer-env"
                        onChange={(event) => setBearerTokenEnv(event.target.value)}
                        placeholder="GITHUB_TOKEN"
                        value={bearerTokenEnv}
                      />
                    </div>
                  </div>
                  <KeyValueRows
                    label="Headers"
                    onAdd={() =>
                      setHeaderRows([...headerRows, { key: "", value: "" }])
                    }
                    onRemove={(index) =>
                      setHeaderRows(
                        headerRows.filter((_, rowIndex) => rowIndex !== index)
                      )
                    }
                    onUpdate={(index, field, value) =>
                      updateRow(headerRows, setHeaderRows, index, field, value)
                    }
                    rows={headerRows}
                  />
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  disabled={
                    isAddingServer ||
                    !serverId.trim() ||
                    (addMode === "command" ? !command.trim() : !url.trim())
                  }
                  onClick={addServer}
                  type="button"
                >
                  <PlusIcon className="size-4" />
                  Add server
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold">Configured Servers</h3>
                <p className="text-xs text-muted-foreground">
                  Connection status is a fresh MCP ping. Enablement controls
                  what this project or conversation can use.
                </p>
              </div>
              <div className="flex gap-2">
                {projectId && (
                  <Button
                    disabled={isSavingProject}
                    onClick={saveProjectToggles}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <SaveIcon className="size-4" />
                    Save project
                  </Button>
                )}
                {chatId && (
                  <Button
                    disabled={isSavingChat}
                    onClick={saveChatOverrides}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <SaveIcon className="size-4" />
                    Save conversation
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              {serverRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No MCP servers configured.
                </div>
              ) : (
                serverRows.map((server) => (
                  <div
                    className="grid gap-3 rounded-lg border border-border px-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(220px,260px)]"
                    key={server.id}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{server.id}</span>
                        <TransportPill transport={server.transport} />
                        <ConnectionBadge state={server.connectionState} />
                        <EnablementBadge source={server.enablementSource} />
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {server.label}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {server.connectionState === "connected" && server.latencyMs
                          ? `${server.latencyMs} ms`
                          : server.message}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      {projectId ? (
                        <label className="flex h-8 items-center gap-2 rounded-md border border-border px-2 text-xs">
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
                          Project default
                        </label>
                      ) : (
                        <div className="flex h-8 items-center rounded-md border border-border px-2 text-xs text-muted-foreground">
                          No project default
                        </div>
                      )}

                      {chatId && (
                        <Select
                          onValueChange={(value: ChatOverrideState) =>
                            setChatOverrides((current) => ({
                              ...current,
                              [server.id]: value,
                            }))
                          }
                          value={chatOverrides[server.id] ?? "inherit"}
                        >
                          <SelectTrigger className="h-8 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">Inherit project</SelectItem>
                            <SelectItem value="enabled">Force on</SelectItem>
                            <SelectItem value="disabled">Force off</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <details className="group rounded-lg border border-border">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[13px] font-semibold">
              <span>Advanced JSON</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {parsedServerIds || "No parsed MCP servers"}
              </span>
            </summary>
            <div className="grid gap-2 border-t border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Literal tokens are stored locally; prefer environment-variable
                  references for secrets.
                </p>
                <Button
                  disabled={isSavingCatalog}
                  onClick={saveCatalog}
                  size="sm"
                  type="button"
                >
                  <SaveIcon className="size-4" />
                  Save JSON
                </Button>
              </div>
              <Textarea
                className="min-h-60 resize-y font-mono text-xs leading-5"
                data-testid="mcp-json-editor"
                onChange={(event) => setDraftJson(event.target.value)}
                spellCheck={false}
                value={draftJson}
              />
            </div>
          </details>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function KeyValueRows({
  label,
  onAdd,
  onRemove,
  onUpdate,
  rows,
}: {
  label: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof KeyValueRow, value: string) => void;
  rows: KeyValueRow[];
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button onClick={onAdd} size="xs" type="button" variant="outline">
          <PlusIcon className="size-3" />
          Add
        </Button>
      </div>
      {rows.length > 0 && (
        <div className="grid gap-2">
          {rows.map((row, index) => (
            <div
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px]"
              key={`${label}-${index}`}
            >
              <Input
                onChange={(event) => onUpdate(index, "key", event.target.value)}
                placeholder="Name"
                value={row.key}
              />
              <Input
                onChange={(event) => onUpdate(index, "value", event.target.value)}
                placeholder="Value"
                value={row.value}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={`Remove ${label} row`}
                    onClick={() => onRemove(index)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove row</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
