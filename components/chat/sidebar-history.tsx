"use client";

import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import { useActiveChat } from "@/hooks/use-active-chat";
import { useProjects } from "@/hooks/use-projects";
import {
  type ChatHistory,
  getChatHistoryPaginationKey,
} from "@/lib/chat-history";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { ChatItem } from "./sidebar-history-item";

type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

const groupChatsByDate = (chats: Chat[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isToday(chatDate)) {
        groups.today.push(chat);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: [],
    } as GroupedChats
  );
};

export function SidebarHistory({ user }: { user: User | undefined }) {
  const { setOpenMobile } = useSidebar();
  const { runningChatIds } = useActiveChat();
  const { selectedProjectId } = useProjects();
  const pathname = usePathname();
  const id = pathname?.startsWith("/chat/") ? pathname.split("/")[2] : null;
  const runningChatIdSet = new Set(runningChatIds);

  const {
    data: paginatedChatHistories,
    setSize,
    error: historyError,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    user
      ? (pageIndex, previousPageData) =>
          getChatHistoryPaginationKey(
            pageIndex,
            previousPageData,
            selectedProjectId
          )
      : () => null,
    fetcher,
    { fallbackData: [], revalidateOnFocus: false }
  );

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const isRequestingNextPageRef = useRef(false);
  const hasLoadedHistory = (paginatedChatHistories?.length ?? 0) > 0;
  const isInitialLoading = isLoading || (!hasLoadedHistory && !historyError);

  const hasReachedEnd = paginatedChatHistories
    ? paginatedChatHistories.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory =
    hasLoadedHistory && paginatedChatHistories
      ? paginatedChatHistories.every((page) => page.chats.length === 0)
      : false;
  const hasMoreHistory =
    hasLoadedHistory && !hasReachedEnd && !hasEmptyChatHistory && !historyError;
  const isLoadingMore = hasMoreHistory && isValidating && !isInitialLoading;
  const chatsFromHistory =
    paginatedChatHistories?.flatMap(
      (paginatedChatHistory) => paginatedChatHistory.chats
    ) ?? [];
  const groupedChats = groupChatsByDate(chatsFromHistory);

  useEffect(() => {
    if (!isValidating) {
      isRequestingNextPageRef.current = false;
    }
  }, [isValidating]);

  const loadMoreHistory = useCallback(() => {
    if (isRequestingNextPageRef.current || isValidating || !hasMoreHistory) {
      return;
    }

    isRequestingNextPageRef.current = true;
    setSize((size) => size + 1);
  }, [hasMoreHistory, isValidating, setSize]);

  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    const scrollRoot = trigger?.closest<HTMLElement>(
      '[data-sidebar="content"]'
    );

    if (!trigger || !scrollRoot || !hasMoreHistory) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMoreHistory();
        }
      },
      {
        root: scrollRoot,
        rootMargin: "96px 0px",
        threshold: 0,
      }
    );

    observer.observe(trigger);
    return () => observer.disconnect();
  }, [hasMoreHistory, loadMoreHistory]);

  const handleDelete = () => {
    const chatToDelete = deleteId;
    const isCurrentChat = pathname === `/chat/${chatToDelete}`;

    setShowDeleteDialog(false);

    if (isCurrentChat) {
      router.replace("/");
    }

    mutate((chatHistories) => {
      if (chatHistories) {
        return chatHistories.map((chatHistory) => ({
          ...chatHistory,
          chats: chatHistory.chats.filter((chat) => chat.id !== chatToDelete),
        }));
      }
    });

    fetch(
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatToDelete}`,
      { method: "DELETE" }
    );

    toast.success("Chat deleted");
  };

  if (!user) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
            Login to save and revisit previous chats!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isInitialLoading) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-0.5 px-1">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                className="flex h-8 items-center gap-2 rounded-lg px-2"
                key={item}
              >
                <div
                  className="h-3 max-w-(--skeleton-width) flex-1 animate-pulse rounded-md bg-sidebar-foreground/[0.06]"
                  style={
                    {
                      "--skeleton-width": `${item}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (historyError && !hasLoadedHistory) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex w-full flex-col items-center justify-center gap-2 px-2 text-center text-[13px] text-sidebar-foreground/60">
            <span>Couldn't load your conversations.</span>
            <button
              className="rounded-md border border-sidebar-border px-2 py-1 text-[12px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={() => {
                isRequestingNextPageRef.current = false;
                mutate();
              }}
              type="button"
            >
              Retry
            </button>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <div className="flex flex-col gap-4">
              {groupedChats.today.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                    Today
                  </div>
                  {groupedChats.today.map((chat) => (
                    <ChatItem
                      chat={chat}
                      isActive={chat.id === id}
                      isRunning={runningChatIdSet.has(chat.id)}
                      key={chat.id}
                      onDelete={(chatId) => {
                        setDeleteId(chatId);
                        setShowDeleteDialog(true);
                      }}
                      setOpenMobile={setOpenMobile}
                    />
                  ))}
                </div>
              )}

              {groupedChats.yesterday.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                    Yesterday
                  </div>
                  {groupedChats.yesterday.map((chat) => (
                    <ChatItem
                      chat={chat}
                      isActive={chat.id === id}
                      isRunning={runningChatIdSet.has(chat.id)}
                      key={chat.id}
                      onDelete={(chatId) => {
                        setDeleteId(chatId);
                        setShowDeleteDialog(true);
                      }}
                      setOpenMobile={setOpenMobile}
                    />
                  ))}
                </div>
              )}

              {groupedChats.lastWeek.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                    Last 7 days
                  </div>
                  {groupedChats.lastWeek.map((chat) => (
                    <ChatItem
                      chat={chat}
                      isActive={chat.id === id}
                      isRunning={runningChatIdSet.has(chat.id)}
                      key={chat.id}
                      onDelete={(chatId) => {
                        setDeleteId(chatId);
                        setShowDeleteDialog(true);
                      }}
                      setOpenMobile={setOpenMobile}
                    />
                  ))}
                </div>
              )}

              {groupedChats.lastMonth.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                    Last 30 days
                  </div>
                  {groupedChats.lastMonth.map((chat) => (
                    <ChatItem
                      chat={chat}
                      isActive={chat.id === id}
                      isRunning={runningChatIdSet.has(chat.id)}
                      key={chat.id}
                      onDelete={(chatId) => {
                        setDeleteId(chatId);
                        setShowDeleteDialog(true);
                      }}
                      setOpenMobile={setOpenMobile}
                    />
                  ))}
                </div>
              )}

              {groupedChats.older.length > 0 && (
                <div>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                    Older
                  </div>
                  {groupedChats.older.map((chat) => (
                    <ChatItem
                      chat={chat}
                      isActive={chat.id === id}
                      isRunning={runningChatIdSet.has(chat.id)}
                      key={chat.id}
                      onDelete={(chatId) => {
                        setDeleteId(chatId);
                        setShowDeleteDialog(true);
                      }}
                      setOpenMobile={setOpenMobile}
                    />
                  ))}
                </div>
              )}
            </div>
          </SidebarMenu>

          <div
            aria-hidden="true"
            className="h-px w-full"
            ref={loadMoreTriggerRef}
          />

          {historyError ? (
            <div className="mt-1 flex flex-row items-center justify-between gap-2 px-4 py-2 text-sidebar-foreground/50">
              <div className="text-[11px]">Couldn't load more.</div>
              <button
                className="rounded-md border border-sidebar-border px-2 py-1 text-[11px] font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => {
                  isRequestingNextPageRef.current = false;
                  mutate();
                }}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : isLoadingMore ? (
            <div className="mt-1 flex flex-row items-center gap-2 px-4 py-2 text-sidebar-foreground/50">
              <div className="animate-spin">
                <LoaderIcon />
              </div>
              <div className="text-[11px]">Loading...</div>
            </div>
          ) : hasMoreHistory ? (
            <button
              className="mt-1 flex w-full items-center justify-center rounded-md px-4 py-2 text-[11px] font-medium text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={loadMoreHistory}
              type="button"
            >
              Load more
            </button>
          ) : null}
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              chat and remove it from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
