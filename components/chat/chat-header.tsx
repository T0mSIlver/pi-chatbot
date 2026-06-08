"use client";

import { BracesIcon, FilesIcon, PanelLeftIcon, PlugIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useProjects } from "@/hooks/use-projects";
import { McpSettingsDialog } from "./mcp-settings-dialog";
import { ProviderCaptureDialog } from "./provider-capture-dialog";

function PureChatHeader({
  chatId,
  isReadonly: _isReadonly,
  isWorkbenchOpen,
  onToggleWorkbench,
}: {
  chatId: string;
  isReadonly: boolean;
  isWorkbenchOpen: boolean;
  onToggleWorkbench: () => void;
}) {
  const pathname = usePathname();
  const { toggleSidebar } = useSidebar();
  const { selectedProject, selectedProjectId } = useProjects();
  const [showProviderCaptures, setShowProviderCaptures] = useState(false);
  const [showMcpSettings, setShowMcpSettings] = useState(false);
  const savedChatId = pathname?.startsWith("/chat/") ? chatId : undefined;

  return (
    <>
      <header className="sticky top-0 flex h-[calc(3.5rem_+_env(safe-area-inset-top))] items-center gap-1.5 bg-sidebar px-2 pt-[env(safe-area-inset-top)] md:gap-2 md:px-3">
        <Button
          aria-label="Open sidebar"
          className="size-10 md:hidden"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftIcon className="size-4" />
        </Button>

        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-sidebar-foreground/70">
          {selectedProject?.name ?? "Standalone"}
        </div>
        <Button
          aria-label="Inspect OpenAI payload"
          className="size-10 md:size-8"
          data-testid="inspect-openai-payload-button"
          onClick={() => setShowProviderCaptures(true)}
          size="icon-sm"
          title="Inspect OpenAI payload"
          type="button"
          variant="ghost"
        >
          <BracesIcon className="size-4" />
        </Button>
        <Button
          aria-label="MCP settings"
          className="size-10 md:size-8"
          data-testid="chat-mcp-settings-button"
          onClick={() => setShowMcpSettings(true)}
          size="icon-sm"
          title="MCP settings"
          type="button"
          variant="ghost"
        >
          <PlugIcon className="size-4" />
        </Button>
        <Button
          aria-label={isWorkbenchOpen ? "Close files" : "Open files"}
          className="size-10 md:size-8"
          data-testid="workspace-files-button"
          onClick={onToggleWorkbench}
          size="icon-sm"
          type="button"
          variant={isWorkbenchOpen ? "secondary" : "ghost"}
        >
          <FilesIcon className="size-4" />
        </Button>
      </header>
      <ProviderCaptureDialog
        chatId={chatId}
        onOpenChange={setShowProviderCaptures}
        open={showProviderCaptures}
      />
      <McpSettingsDialog
        chatId={savedChatId}
        onOpenChange={setShowMcpSettings}
        open={showMcpSettings}
        projectId={selectedProjectId}
      />
    </>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.chatId === nextProps.chatId &&
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.isWorkbenchOpen === nextProps.isWorkbenchOpen
  );
});
