"use client";

import {
  CodeIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  GlobeIcon,
  ImageIcon,
  RefreshCwIcon,
  TableIcon,
  XIcon,
} from "lucide-react";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { MessageResponse } from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
  ChatStatus,
  WorkspaceChange,
  WorkspaceDisplayIntent,
  WorkspaceFileKind,
  WorkspaceFileNode,
} from "@/lib/types";
import { cn, fetcher } from "@/lib/utils";

type WorkspaceTab = "explorer" | "changed" | "preview";

type WorkspaceTreeResponse = {
  roots: WorkspaceFileNode[];
  generatedAt: string;
};

type WorkspaceChangesResponse = {
  updatedAt: string | null;
  changes: WorkspaceChange[];
};

type WorkspaceFileResponse = {
  file: {
    path: string;
    scope: "conversation" | "shared";
    name: string;
    fileKind: WorkspaceFileKind;
    size: number;
    mtime: string;
    content?: string;
    contentTruncated: boolean;
    contentType: string;
    appUrl: string;
  };
};

type WorkspaceWorkbenchProps = {
  chatId: string;
  open: boolean;
  selectedIntent: WorkspaceDisplayIntent | null;
  status: ChatStatus;
  onClose: () => void;
  onSelectIntent: (intent: WorkspaceDisplayIntent) => void;
  className?: string;
};

function pathKey(intent: WorkspaceDisplayIntent | null) {
  return intent ? `${intent.scope}:${intent.path}` : "";
}

function fileKindIcon(fileKind?: WorkspaceFileKind) {
  if (fileKind === "image") {
    return <ImageIcon className="size-3.5" />;
  }
  if (fileKind === "html_app") {
    return <GlobeIcon className="size-3.5" />;
  }
  if (fileKind === "csv") {
    return <TableIcon className="size-3.5" />;
  }
  if (fileKind === "code") {
    return <CodeIcon className="size-3.5" />;
  }
  if (fileKind === "markdown" || fileKind === "text") {
    return <FileTextIcon className="size-3.5" />;
  }
  return <FileIcon className="size-3.5" />;
}

function displayModeForFileKind(fileKind?: WorkspaceFileKind) {
  return fileKind && fileKind !== "binary" ? fileKind : undefined;
}

function formatBytes(bytes: number | undefined) {
  if (bytes === undefined) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeFileIntent({
  chatId,
  node,
}: {
  chatId: string;
  node: WorkspaceFileNode;
}): WorkspaceDisplayIntent {
  return {
    type: "workspace-file",
    chatId,
    scope: node.scope,
    path: node.path,
    title: node.name,
    mode: displayModeForFileKind(node.fileKind),
  };
}

function FileTreeNode({
  chatId,
  node,
  level,
  selectedKey,
  onSelect,
}: {
  chatId: string;
  node: WorkspaceFileNode;
  level: number;
  selectedKey: string;
  onSelect: (intent: WorkspaceDisplayIntent) => void;
}) {
  const [expanded, setExpanded] = useState(level === 0);
  const isDirectory = node.kind === "directory";
  const isSelected =
    !isDirectory && selectedKey === `${node.scope}:${node.path}`;

  if (isDirectory) {
    return (
      <div>
        <button
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={() => setExpanded((current) => !current)}
          style={{ paddingLeft: 8 + level * 14 }}
          type="button"
        >
          {expanded ? (
            <FolderOpenIcon className="size-3.5" />
          ) : (
            <FolderIcon className="size-3.5" />
          )}
          <span className="min-w-0 truncate font-medium">{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <FileTreeNode
              chatId={chatId}
              key={`${child.scope}:${child.path}`}
              level={level + 1}
              node={child}
              onSelect={onSelect}
              selectedKey={selectedKey}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors hover:bg-muted/60",
        isSelected
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
      onClick={() => onSelect(makeFileIntent({ chatId, node }))}
      style={{ paddingLeft: 8 + level * 14 }}
      type="button"
    >
      {fileKindIcon(node.fileKind)}
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {node.size !== undefined && (
        <span className="shrink-0 text-[10px] text-muted-foreground/70">
          {formatBytes(node.size)}
        </span>
      )}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
      {text}
    </div>
  );
}

function ExplorerPane({
  chatId,
  roots,
  selectedIntent,
  onSelect,
}: {
  chatId: string;
  roots: WorkspaceFileNode[] | undefined;
  selectedIntent: WorkspaceDisplayIntent | null;
  onSelect: (intent: WorkspaceDisplayIntent) => void;
}) {
  if (!roots) {
    return <EmptyState text="Loading workspace files..." />;
  }

  const hasFiles = roots.some(
    (root) => root.children && root.children.length > 0
  );
  if (!hasFiles) {
    return <EmptyState text="No workspace files yet." />;
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2">
        {roots.map((root) => (
          <FileTreeNode
            chatId={chatId}
            key={root.scope}
            level={0}
            node={root}
            onSelect={onSelect}
            selectedKey={pathKey(selectedIntent)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function ChangeBadge({ change }: { change: WorkspaceChange["change"] }) {
  const labels: Record<WorkspaceChange["change"], string> = {
    created: "Created",
    deleted: "Deleted",
    modified: "Modified",
  };

  return (
    <Badge
      className={cn(
        "h-5 rounded-full px-2 text-[10px]",
        change === "created" && "bg-emerald-500/10 text-emerald-600",
        change === "modified" && "bg-amber-500/10 text-amber-600",
        change === "deleted" && "bg-destructive/10 text-destructive"
      )}
      variant="secondary"
    >
      {labels[change]}
    </Badge>
  );
}

function ChangedPane({
  chatId,
  changes,
  onSelect,
}: {
  chatId: string;
  changes: WorkspaceChange[] | undefined;
  onSelect: (intent: WorkspaceDisplayIntent) => void;
}) {
  if (!changes) {
    return <EmptyState text="Loading changed files..." />;
  }

  if (changes.length === 0) {
    return <EmptyState text="No changed files recorded for the latest turn." />;
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-2">
        {changes.map((change) => {
          const disabled = change.change === "deleted";
          return (
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] transition-colors",
                disabled
                  ? "cursor-not-allowed text-muted-foreground/60"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              disabled={disabled}
              key={`${change.scope}:${change.path}:${change.change}`}
              onClick={() =>
                onSelect({
                  type: "workspace-file",
                  chatId,
                  scope: change.scope,
                  path: change.path,
                  title: change.path.split("/").at(-1),
                  mode: displayModeForFileKind(change.fileKind),
                })
              }
              type="button"
            >
              {fileKindIcon(change.fileKind)}
              <span className="min-w-0 flex-1 truncate">
                {change.scope === "shared" ? "project-shared/" : ""}
                {change.path}
              </span>
              <ChangeBadge change={change.change} />
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function CsvPreview({ content }: { content: string }) {
  const parsed = useMemo(() => {
    const rows = Papa.parse<string[]>(content, {
      skipEmptyLines: true,
    }).data.slice(0, 100);

    return rows.map((row) => ({
      id: crypto.randomUUID(),
      cells: row.map((cell) => ({
        id: crypto.randomUUID(),
        value: cell,
      })),
    }));
  }, [content]);

  if (parsed.length === 0) {
    return <EmptyState text="This CSV file is empty." />;
  }

  return (
    <div className="overflow-auto p-3">
      <table className="w-full border-collapse text-left text-[12px]">
        <tbody>
          {parsed.map((row, rowIndex) => (
            <tr
              className={rowIndex === 0 ? "bg-muted/60 font-medium" : ""}
              key={row.id}
            >
              {row.cells.map((cell) => (
                <td
                  className="max-w-[220px] truncate border border-border/60 px-2 py-1"
                  key={cell.id}
                  title={cell.value}
                >
                  {cell.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextPreview({ content }: { content: string }) {
  return (
    <pre className="min-h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-5">
      {content}
    </pre>
  );
}

function FileMetadata({ file }: { file: WorkspaceFileResponse["file"] }) {
  return (
    <div className="space-y-3 p-4 text-[12px]">
      <div className="grid grid-cols-[90px_1fr] gap-2">
        <span className="text-muted-foreground">Type</span>
        <span>{file.fileKind}</span>
        <span className="text-muted-foreground">Size</span>
        <span>{formatBytes(file.size)}</span>
        <span className="text-muted-foreground">Modified</span>
        <span>{new Date(file.mtime).toLocaleString()}</span>
      </div>
      {file.contentTruncated && (
        <p className="text-muted-foreground">
          The file is too large to preview inline.
        </p>
      )}
    </div>
  );
}

function FilePreview({
  file,
}: {
  file: WorkspaceFileResponse["file"] | undefined;
}) {
  if (!file) {
    return <EmptyState text="Select a file to preview." />;
  }

  if (file.fileKind === "image") {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-muted/30 p-4">
        <picture>
          <img
            alt={file.name}
            className="max-h-full max-w-full object-contain"
            src={file.appUrl}
          />
        </picture>
      </div>
    );
  }

  if (file.fileKind === "html_app") {
    return (
      <iframe
        className="h-full w-full border-0 bg-white"
        sandbox="allow-scripts"
        src={file.appUrl}
        title={file.name}
      />
    );
  }

  if (file.content === undefined) {
    return <FileMetadata file={file} />;
  }

  if (file.fileKind === "markdown") {
    return (
      <ScrollArea className="h-full">
        <div className="prose prose-sm max-w-none p-4 dark:prose-invert">
          <MessageResponse>{file.content}</MessageResponse>
        </div>
      </ScrollArea>
    );
  }

  if (file.fileKind === "csv") {
    return <CsvPreview content={file.content} />;
  }

  return <TextPreview content={file.content} />;
}

export function WorkspaceWorkbench({
  chatId,
  open,
  selectedIntent,
  status,
  onClose,
  onSelectIntent,
  className,
}: WorkspaceWorkbenchProps) {
  const { mutate } = useSWRConfig();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("explorer");
  const treeKey = open
    ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/tree?chatId=${chatId}`
    : null;
  const changesKey = open
    ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/changes?chatId=${chatId}`
    : null;
  const fileKey =
    open && selectedIntent
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/workspace/file?${new URLSearchParams(
          {
            chatId,
            scope: selectedIntent.scope,
            path: selectedIntent.path,
          }
        )}`
      : null;

  const { data: treeData, error: treeError } = useSWR<WorkspaceTreeResponse>(
    treeKey,
    fetcher,
    { revalidateOnFocus: false }
  );
  const { data: changesData } = useSWR<WorkspaceChangesResponse>(
    changesKey,
    fetcher,
    { revalidateOnFocus: false }
  );
  const { data: fileData, error: fileError } = useSWR<WorkspaceFileResponse>(
    fileKey,
    fetcher,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (selectedIntent) {
      setActiveTab("preview");
    }
  }, [selectedIntent]);

  useEffect(() => {
    if (!open || status !== "ready") {
      return;
    }
    if (treeKey) {
      mutate(treeKey);
    }
    if (changesKey) {
      mutate(changesKey);
    }
    if (fileKey) {
      mutate(fileKey);
    }
  }, [changesKey, fileKey, mutate, open, status, treeKey]);

  const selectIntent = (intent: WorkspaceDisplayIntent) => {
    onSelectIntent(intent);
    setActiveTab("preview");
  };

  const tabs: Array<{ id: WorkspaceTab; label: string }> = [
    { id: "explorer", label: "Explorer" },
    { id: "changed", label: "Changed" },
    { id: "preview", label: "Preview" },
  ];

  return (
    <aside
      className={cn(
        "flex h-full min-w-0 flex-col border-l border-border/60 bg-background",
        className
      )}
      data-testid="workspace-workbench"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">Files</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedIntent
              ? `${selectedIntent.scope === "shared" ? "project-shared/" : ""}${selectedIntent.path}`
              : "Workspace"}
          </div>
        </div>
        <Button
          aria-label="Refresh workspace files"
          onClick={() => {
            if (treeKey) {
              mutate(treeKey);
            }
            if (changesKey) {
              mutate(changesKey);
            }
            if (fileKey) {
              mutate(fileKey);
            }
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon className="size-4" />
        </Button>
        <Button
          aria-label="Close files"
          data-testid="workspace-workbench-close"
          onClick={onClose}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-border/60 p-2">
        {tabs.map((tab) => (
          <button
            className={cn(
              "h-7 flex-1 rounded-md px-2 text-[12px] transition-colors",
              activeTab === tab.id
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
            data-testid={`workspace-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {treeError ? (
          <EmptyState text="No workspace is available for this chat yet." />
        ) : activeTab === "explorer" ? (
          <ExplorerPane
            chatId={chatId}
            onSelect={selectIntent}
            roots={treeData?.roots}
            selectedIntent={selectedIntent}
          />
        ) : activeTab === "changed" ? (
          <ChangedPane
            changes={changesData?.changes}
            chatId={chatId}
            onSelect={selectIntent}
          />
        ) : fileError ? (
          <EmptyState text="This file could not be loaded." />
        ) : (
          <FilePreview file={fileData?.file} />
        )}
      </div>
    </aside>
  );
}
