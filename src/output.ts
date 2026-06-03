import type { SessionSummary, SubagentRun } from "./types.js";

export type DetailLevel = "medium" | "full";

export interface OutputDocument {
  summary: unknown;
  runs: unknown[];
}

export function buildOutput(summary: SessionSummary, runs: SubagentRun[], detail: DetailLevel): OutputDocument {
  return {
    summary: detail === "full" ? fullSummary(summary, runs) : mediumSummary(summary, runs),
    runs: runs.map((run) => (detail === "full" ? fullRun(run) : mediumRun(run)))
  };
}

function mediumSummary(summary: SessionSummary, runs: SubagentRun[]): Record<string, unknown> {
  return {
    running: summary.running,
    stopped: summary.stopped,
    closed: summary.closed,
    total: summary.total,
    shown: runs.length
  };
}

function fullSummary(summary: SessionSummary, runs: SubagentRun[]): Record<string, unknown> {
  return {
    ...summary,
    shown: runs.length
  };
}

function mediumRun(run: SubagentRun): Record<string, unknown> {
  return {
    agentId: run.agentId ?? run.subagentId,
    agentType: run.agentType,
    status: run.status,
    closed: run.closed,
    prompt: run.prompt,
    startTime: run.startTime,
    stopTime: run.stopTime,
    closeTime: run.closeTime,
    durationMs: run.durationMs,
    lastAssistantMessage: run.lastAssistantMessage,
    model: run.model,
    cwd: run.cwd
  };
}

function fullRun(run: SubagentRun): Record<string, unknown> {
  return {
    ...run,
    startPayload: parsePayload(run.startPayload),
    stopPayload: run.stopPayload === null ? null : parsePayload(run.stopPayload),
    closePayload: run.closePayload === null ? null : parsePayload(run.closePayload)
  };
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}
