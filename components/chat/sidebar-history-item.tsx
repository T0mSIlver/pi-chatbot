import Link from "next/link";
import { memo } from "react";
import type { Chat } from "@/lib/db/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { MoreHorizontalIcon, TrashIcon } from "./icons";

const PureChatItem = ({
  chat,
  isActive,
  isRunning,
  onDelete,
  setOpenMobile,
}: {
  chat: Chat;
  isActive: boolean;
  isRunning: boolean;
  onDelete: (chatId: string) => void;
  setOpenMobile: (open: boolean) => void;
}) => {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className="min-h-11 rounded-none pr-7 text-[13px] text-sidebar-foreground/50 transition-all duration-150 hover:bg-transparent hover:text-sidebar-foreground data-active:bg-transparent data-active:font-normal data-active:text-sidebar-foreground/50 data-[active=true]:border-b data-[active=true]:border-dashed data-[active=true]:border-sidebar-foreground/50 data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground"
        isActive={isActive}
      >
        <Link href={`/chat/${chat.id}`} onClick={() => setOpenMobile(false)}>
          <span className="flex min-w-0 flex-col gap-0.5 py-1">
            <span className="flex min-w-0 items-center gap-1.5">
              {isRunning && (
                <span
                  className="relative flex size-2 shrink-0"
                  title="Generating"
                >
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/50" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  <span className="sr-only">Generating</span>
                </span>
              )}
              <span className="truncate">{chat.title}</span>
            </span>
            {chat.summary && (
              <span className="line-clamp-2 text-[11px] leading-snug text-sidebar-foreground/40">
                {chat.summary}
              </span>
            )}
          </span>
        </Link>
      </SidebarMenuButton>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className="mr-0.5 rounded-md text-sidebar-foreground/50 ring-0 transition-colors duration-150 focus-visible:ring-0 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            showOnHover={!isActive}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuItem
            onSelect={() => onDelete(chat.id)}
            variant="destructive"
          >
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  if (prevProps.isRunning !== nextProps.isRunning) {
    return false;
  }
  return (
    prevProps.chat.id === nextProps.chat.id &&
    prevProps.chat.title === nextProps.chat.title &&
    prevProps.chat.summary === nextProps.chat.summary
  );
});
