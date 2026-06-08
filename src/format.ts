import type { SessionSummary, SubagentRun } from "./types.js";
import { publicRunState } from "./state.js";

export interface FormatOptions {
  now?: Date;
}

export function formatSession(summary: SessionSummary, runs: SubagentRun[], options: FormatOptions = {}): string {
  const lines = [
    `session ${summary.sessionId} total=${summary.total} running=${summary.running} stopped=${summary.stopped} closed=${summary.closed}`
  ];

  if (runs.length === 0) {
    lines.push("no subagents");
    return `${lines.join("\n")}\n`;
  }

  for (const run of runs) {
    const name = run.agentId ?? run.subagentId;
    const type = run.agentType ? ` ${run.agentType}` : "";
    const state = publicRunState(run);
    const status = state === "closed" ? "Closed" : state === "running" ? "Pending" : "Stopped";
    const elapsed = elapsedLabel(run, options.now ?? new Date());
    const prompt = run.prompt ? ` ${truncate(oneLine(run.prompt), 72)}` : "";
    lines.push(`${status} ${name}${type} ${elapsed}${prompt}`);
  }

  return `${lines.join("\n")}\n`;
}

function elapsedLabel(run: SubagentRun, now: Date): string {
  const start = new Date(run.startTime).getTime();
  const end = run.stopTime ? new Date(run.stopTime).getTime() : now.getTime();
  const ms = Math.max(0, end - start);
  return formatDuration(ms);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) {
    return restSeconds === 0 ? `${minutes}m` : `${minutes}m${restSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h${restMinutes}m`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}
