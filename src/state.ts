import type { SubagentRun } from "./types.js";

export type SubagentState = "running" | "stopped" | "closed";
export type StopReason = "hook" | "pid-change" | null;

export function publicRunState(run: Pick<SubagentRun, "status" | "closed">): SubagentState {
  return run.closed ? "closed" : run.status;
}

export function stopReason(run: Pick<SubagentRun, "status" | "stopEventId" | "stopTime">): StopReason {
  if (run.status !== "stopped") {
    return null;
  }

  if (run.stopEventId !== null) {
    return "hook";
  }

  return run.stopTime === null ? null : "pid-change";
}
