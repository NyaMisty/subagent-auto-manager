import type { SessionSummary, SubagentRun } from "./types.js";
import { publicRunState, stopReason } from "./state.js";

export type DetailLevel = "summary" | "compact" | "medium" | "full";

export interface OutputDocument {
  summary: unknown;
  runs?: unknown[];
}

export function buildOutput(summary: SessionSummary, runs: SubagentRun[], detail: DetailLevel): OutputDocument {
  const output: OutputDocument = {
    summary: detail === "full" ? fullSummary(summary, runs) : mediumSummary(summary, runs)
  };

  if (detail !== "summary") {
    output.runs = runs.map((run) => (detail === "full" ? fullRun(run) : detail === "medium" ? mediumRun(run) : compactRun(run)));
  }

  return output;
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
    state: publicRunState(run),
    prompt: run.prompt,
    startTime: run.startTime,
    stopTime: run.stopTime,
    stopReason: stopReason(run),
    closeTime: run.closeTime,
    durationMs: run.durationMs,
    lastAssistantMessage: run.lastAssistantMessage,
    startArgs: run.startArgs === null ? null : parsePayload(run.startArgs),
    model: run.model,
    cwd: run.cwd
  };
}

function compactRun(run: SubagentRun): Record<string, unknown> {
  const output: Record<string, unknown> = {
    agentId: run.agentId ?? run.subagentId,
    state: run.closed ? "closed" : run.status
  };

  const reason = stopReason(run);
  if (reason !== null) {
    output.stopReason = reason;
  }

  return output;
}

function fullRun(run: SubagentRun): Record<string, unknown> {
  const { status: _status, closed: _closed, ...publicRun } = run;
  return {
    ...publicRun,
    state: publicRunState(run),
    stopReason: stopReason(run),
    startArgs: run.startArgs === null ? null : parsePayload(run.startArgs),
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
