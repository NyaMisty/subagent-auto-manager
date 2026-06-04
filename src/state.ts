import type { SubagentRun } from "./types.js";

export type SubagentState = "running" | "stopped" | "closed";

export function publicRunState(run: Pick<SubagentRun, "status" | "closed">): SubagentState {
  return run.closed ? "closed" : run.status;
}
