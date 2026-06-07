"use client";

import { BracesIcon, FilesIcon, PanelLeftIcon } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
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
  const { toggleSidebar } = useSidebar();
  const [showProviderCaptures, setShowProviderCaptures] = useState(false);

  return (
    <>
      <header className="sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3">
        <Button
          className="md:hidden"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftIcon className="size-4" />
        </Button>

        <div className="min-w-0 truncate text-[13px] font-medium text-sidebar-foreground/70">
          All conversations
        </div>
        <Button
          aria-label="Inspect OpenAI payload"
          className="ml-auto"
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
          aria-label={isWorkbenchOpen ? "Close files" : "Open files"}
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
