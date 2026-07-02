"use client";

import {
  BombIcon,
  ListIcon,
  PaletteIcon,
  PenLineIcon,
  PenSquareIcon,
  PuzzleIcon,
  SquareSlashIcon,
  TerminalIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type SlashCommandSource =
  | "app"
  | "builtin"
  | "extension"
  | "prompt"
  | "skill";

export type SlashCommand = {
  name: string;
  description: string;
  icon?: ReactNode;
  action: string;
  source: SlashCommandSource;
  argumentHint?: string;
  shortcut?: string;
};

/** Shape returned by GET /api/chat/[id]/commands */
export type PiSlashCommandDto = {
  name: string;
  description?: string;
  source: Exclude<SlashCommandSource, "app">;
  argumentHint?: string;
};

/** Client-side app actions, executed locally without touching the agent. */
export const slashCommands: SlashCommand[] = [
  {
    name: "new",
    description: "Start a new chat",
    icon: <PenSquareIcon className="size-3.5" />,
    action: "new",
    source: "app",
  },
  {
    name: "clear",
    description: "Clear current chat",
    icon: <Trash2Icon className="size-3.5" />,
    action: "clear",
    source: "app",
  },
  {
    name: "rename",
    description: "Rename current chat",
    icon: <PenLineIcon className="size-3.5" />,
    action: "rename",
    source: "app",
  },
  {
    name: "model",
    description: "Change the AI model",
    icon: <ListIcon className="size-3.5" />,
    action: "model",
    source: "app",
  },
  {
    name: "theme",
    description: "Toggle dark/light mode",
    icon: <PaletteIcon className="size-3.5" />,
    action: "theme",
    source: "app",
  },
  {
    name: "delete",
    description: "Delete current chat",
    icon: <XIcon className="size-3.5" />,
    action: "delete",
    source: "app",
  },
  {
    name: "purge",
    description: "Delete all chats",
    icon: <BombIcon className="size-3.5" />,
    action: "purge",
    source: "app",
  },
];

function sourceIcon(source: SlashCommandSource) {
  switch (source) {
    case "extension":
      return <PuzzleIcon className="size-3.5" />;
    case "prompt":
      return <SquareSlashIcon className="size-3.5" />;
    case "skill":
      return <WrenchIcon className="size-3.5" />;
    default:
      return <TerminalIcon className="size-3.5" />;
  }
}

const sourceLabels: Record<SlashCommandSource, string | null> = {
  app: null,
  builtin: "pi",
  extension: "extension",
  prompt: "prompt",
  skill: "skill",
};

/**
 * Combine app commands with the agent's commands. App commands win name
 * collisions so local actions stay predictable.
 */
export function mergeSlashCommands(
  piCommands: PiSlashCommandDto[] | undefined
): SlashCommand[] {
  const merged = [...slashCommands];
  const names = new Set(merged.map((command) => command.name));

  for (const command of piCommands ?? []) {
    if (names.has(command.name)) {
      continue;
    }
    names.add(command.name);
    merged.push({
      name: command.name,
      description: command.description ?? "",
      action: "pi",
      source: command.source,
      argumentHint: command.argumentHint,
    });
  }

  return merged;
}

export function filterSlashCommands(
  commands: SlashCommand[],
  query: string
): SlashCommand[] {
  const normalized = query.toLowerCase();
  return commands.filter((command) => {
    const name = command.name.toLowerCase();
    return (
      name.startsWith(normalized) ||
      name.split(":").some((part) => part.startsWith(normalized))
    );
  });
}

type SlashCommandMenuProps = {
  commands: SlashCommand[];
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
  selectedIndex: number;
};

export function SlashCommandMenu({
  commands,
  query,
  onSelect,
  onClose: _onClose,
  selectedIndex,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const filtered = filterSlashCommands(commands, query);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the highlighted row moves; it is read from the DOM via data-selected
  useEffect(() => {
    const selected = menuRef.current?.querySelector("[data-selected='true']");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border/50 bg-card/95 shadow-[var(--shadow-float)] backdrop-blur-xl"
      ref={menuRef}
    >
      <div className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">
        Commands
      </div>
      <div className="max-h-64 overflow-y-auto pb-1 no-scrollbar">
        {filtered.map((cmd, index) => (
          <button
            className={cn(
              "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
              index === selectedIndex ? "bg-muted/70" : "hover:bg-muted/40"
            )}
            data-selected={index === selectedIndex}
            key={cmd.name}
            onClick={() => onSelect(cmd)}
            onMouseDown={(e) => e.preventDefault()}
            type="button"
          >
            <div className="flex size-6 shrink-0 items-center justify-center text-muted-foreground/60">
              {cmd.icon ?? sourceIcon(cmd.source)}
            </div>
            <span className="shrink-0 font-mono text-[13px] text-foreground">
              /{cmd.name}
              {cmd.argumentHint && (
                <span className="ml-1.5 text-muted-foreground/40">
                  {cmd.argumentHint}
                </span>
              )}
            </span>
            <span className="min-w-0 truncate text-[12px] text-muted-foreground/50">
              {cmd.description}
            </span>
            {(cmd.shortcut || sourceLabels[cmd.source]) && (
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/30">
                {cmd.shortcut ?? sourceLabels[cmd.source]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
