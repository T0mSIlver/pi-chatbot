"use client";

import { useState } from "react";
import type { ProviderTokenStats } from "@/lib/types";
import { cn } from "@/lib/utils";

type ProviderStatsToggleProps = {
  className?: string;
  stats: ProviderTokenStats;
};

type StatsMode = "prompt" | "generation";

function formatInteger(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat().format(Math.round(value))
    : "-";
}

function formatDurationMs(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  return `${(value / 1000).toFixed(2)} s`;
}

function formatSpeed(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(value >= 100 ? 0 : 1)} tok/s`
    : "-";
}

function statsForMode(stats: ProviderTokenStats, mode: StatsMode) {
  if (mode === "prompt") {
    return {
      label: "PP",
      tokens: stats.promptTokens,
      time: stats.promptTimeMs,
      speed: stats.promptTokensPerSecond,
    };
  }

  return {
    label: "Gen",
    tokens: stats.generatedTokens,
    time: stats.generationTimeMs,
    speed: stats.generationTokensPerSecond,
  };
}

export function ProviderStatsToggle({
  className,
  stats,
}: ProviderStatsToggleProps) {
  const [mode, setMode] = useState<StatsMode>("prompt");
  const activeStats = statsForMode(stats, mode);

  return (
    <div
      className={cn(
        "flex w-fit max-w-full flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground",
        className
      )}
      data-testid="provider-stats"
    >
      <div className="flex rounded-md border border-border bg-muted/20 p-0.5">
        {(["prompt", "generation"] as const).map((candidateMode) => {
          const isActive = mode === candidateMode;
          const label = candidateMode === "prompt" ? "PP" : "Gen";
          return (
            <button
              aria-pressed={isActive}
              className={cn(
                "h-5 min-w-8 rounded px-1.5 font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid={`provider-stats-${candidateMode}`}
              key={candidateMode}
              onClick={() => setMode(candidateMode)}
              type="button"
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className="whitespace-nowrap">{activeStats.label}</span>
      <span className="whitespace-nowrap">
        {formatInteger(activeStats.tokens)} tok
      </span>
      <span aria-hidden="true">/</span>
      <span className="whitespace-nowrap">
        {formatDurationMs(activeStats.time)}
      </span>
      <span aria-hidden="true">/</span>
      <span className="whitespace-nowrap">
        {formatSpeed(activeStats.speed)}
      </span>
    </div>
  );
}
