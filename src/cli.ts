#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRootFrom } from "./paths.js";
import { isDirectEntry } from "./runtime.js";
import { sessionIdFromEnv } from "./session.js";
import { formatSession } from "./format.js";
import { buildOutput, type DetailLevel } from "./output.js";
import { collectProcessLineage, isCodexProcess, resolveCodexSessionPid } from "./process-tree.js";
import { publicRunState } from "./state.js";
import { toYaml } from "./yaml.js";
import type { SubagentLedger } from "./ledger.js";
import type { SubagentRun } from "./types.js";

interface CliOptions {
  command: "list" | "running" | "reset" | "wait" | "hook" | "debug" | "help" | "version";
  session?: string;
  cwd?: string;
  agent?: string;
  waitTargets: string[];
  waitAllRunning: boolean;
  resetFull: boolean;
  timeoutMs: number;
  intervalMs: number;
  output: "json" | "yaml" | "text";
  outputExplicit: boolean;
  detail: DetailLevel;
  detailExplicit: boolean;
  fullBeforeReset: boolean;
  hasListFilter: boolean;
  allRequested: boolean;
  listFilterArgs: string[];
  detailArgs: string[];
  waitOptionArgs: string[];
  status: "running" | "stopped" | "closed" | "all";
  afterTimestamp?: number;
  human: boolean;
}

interface WaitTargetStatus {
  target: string;
  state: "stopped" | "running" | "missing";
  agentId: string | null;
  subagentId: string | null;
  runKey: string | null;
  agentType: string | null;
  closed: boolean | null;
  startTime: string | null;
  stopTime: string | null;
  durationMs: number | null;
  lastAssistantMessage: string | null;
}

interface WaitResult {
  summary: {
    sessionId: string;
    complete: boolean;
    total: number;
    stopped: number;
    running: number;
    missing: number;
    timeoutMs: number;
    elapsedMs: number;
  };
  incompleteTargets: WaitTargetStatus[];
  targets: WaitTargetStatus[];
}

interface DebugProcessRow {
  depth: number;
  pid: number;
  parentPid: number | null;
  name: string | null;
  commandLine: string | null;
  isCodex: boolean;
}

interface DebugReport {
  generatedAt: string;
  command: "debug";
  environment: {
    platform: NodeJS.Platform;
    pid: number;
    ppid: number;
    CODEX_PID: string | null;
    CODEX_THREAD_ID: string | null;
    CODEX_MANAGED_BY_NPM: string | null;
    CODEX_MANAGED_PACKAGE_ROOT: string | null;
  };
  processIdentity: {
    codexSessionPid: number | null;
    codexSessionPidSource: "CODEX_PID" | "ppid-chain" | null;
    hookParentPid: number | null;
    hookSessionPid: number | null;
    hookSessionPidSource: "CODEX_PID" | "ppid-chain" | null;
    envCodexPid: number | null;
    recursiveCodexPid: number | null;
    directParentIsCodex: boolean;
    codexAncestorCount: number;
  };
  processLineage: DebugProcessRow[];
  ledger: {
    projectRoot: string;
    sessionId: string;
    summary: unknown;
    recentRuns: Array<{
      runKey: string;
      agentId: string | null;
      subagentId: string;
      state: "running" | "stopped" | "closed";
      codexSessionPid: number | null;
      hookParentPid: number | null;
      hookSessionPid: number | null;
      startTime: string;
      stopTime: string | null;
      stopEventId: number | null;
      stopPayloadPresent: boolean;
    }>;
    pidGroups: {
      codexSessionPid: Array<{ pid: number | null; count: number }>;
      hookParentPid: Array<{ pid: number | null; count: number }>;
      hookSessionPid: Array<{ pid: number | null; count: number }>;
    };
  };
  assessment: {
    ppidMatchesCodex: boolean;
    sessionPidResolved: boolean;
    staleDetectionAvailable: boolean;
    notes: string[];
  };
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<void> {
  const options = parseArgs(argv);

  if (options.command === "help") {
    process.stdout.write(helpText());
    return;
  }

  if (options.command === "version") {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }

  if (options.command === "hook") {
    try {
      const { runHook } = await import("./hook.js");
      await runHook();
    } catch (error: unknown) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.stdout.write("{}\n");
      process.exitCode = 1;
    }
    return;
  }

  const sessionId = options.session ?? sessionIdFromEnv(env);
  const projectRoot = projectRootFrom({ cwd: options.cwd });
  const { SubagentLedger } = await import("./ledger.js");
  const ledger = SubagentLedger.open(projectRoot);

  try {
    if (options.command === "debug" || options.command === "wait" || options.command === "list" || options.command === "running") {
      reconcileCurrentSessionProcess(ledger, sessionId, env);
    }

    if (options.command === "debug") {
      const report = buildDebugReport(ledger.listSession(sessionId, true), ledger.summary(sessionId), sessionId, projectRoot, env);
      writeDebugReport(report, options.output);
      return;
    }

    if (options.command === "reset") {
      if (options.agent) {
        const result = ledger.resetClosed(sessionId, options.agent);
        const output = { sessionId, agentId: options.agent, ...result };
        if (options.output === "json") {
          process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        } else if (options.output === "yaml") {
          process.stdout.write(toYaml(output));
        } else {
          process.stdout.write(`reset closed session=${sessionId} agent=${options.agent} matched=${result.matched} reset=${result.reset}\n`);
        }
      } else if (options.resetFull) {
        const result = ledger.closeAllOpen(sessionId);
        const output = { sessionId, agentId: null, mode: "full", ...result };
        if (options.output === "json") {
          process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        } else if (options.output === "yaml") {
          process.stdout.write(toYaml(output));
        } else {
          process.stdout.write(`reset full session=${sessionId} matched=${result.matched} closed=${result.closed}\n`);
        }
      } else {
        const result = ledger.closeStopped(sessionId);
        const output = { sessionId, agentId: null, ...result };
        if (options.output === "json") {
          process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        } else if (options.output === "yaml") {
          process.stdout.write(toYaml(output));
        } else {
          process.stdout.write(`reset stopped session=${sessionId} matched=${result.matched} closed=${result.closed}\n`);
        }
      }
      return;
    }

    if (options.command === "wait") {
      const result = await waitForAgents(ledger, sessionId, options);
      writeWaitResult(result, options.output);
      if (!result.summary.complete) {
        process.exitCode = 1;
      }
      return;
    }

    const summary = ledger.summary(sessionId);
    const runs = filterRuns(ledger.listSession(sessionId, true), sessionId, options.status, options.afterTimestamp, options.agent);
    const detail = effectiveDetail(options);
    const result = buildOutput(summary, runs, detail);
    if (options.output === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (options.output === "yaml") {
      process.stdout.write(toYaml(result));
    } else {
      process.stdout.write(formatSession(summary, runs));
    }
    writeHints(options, sessionId, runs.length, summary.total);
  } finally {
    ledger.close();
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "running",
    waitTargets: [],
    waitAllRunning: false,
    resetFull: false,
    timeoutMs: 30000,
    intervalMs: 1000,
    output: "json",
    outputExplicit: false,
    detail: "medium",
    detailExplicit: false,
    fullBeforeReset: false,
    hasListFilter: false,
    allRequested: false,
    listFilterArgs: [],
    detailArgs: [],
    waitOptionArgs: [],
    status: "running",
    human: false
  };

  let commandSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "list" || arg === "running" || arg === "reset" || arg === "wait" || arg === "hook" || arg === "debug") {
      if (commandSeen) {
        throw new Error("only one command may be provided");
      }
      commandSeen = true;
      if (arg === "reset" && options.detail === "full" && options.detailExplicit) {
        options.fullBeforeReset = true;
      }
      options.command = arg;
      if (arg === "list") {
        options.status = "all";
        options.hasListFilter = true;
        options.listFilterArgs.push("list");
      }
      if (arg === "running") {
        options.status = "running";
        options.hasListFilter = true;
      }
      continue;
    }

    if (arg === "help" || arg === "--help" || arg === "-h") {
      if (commandSeen) {
        throw new Error("only one command may be provided");
      }
      options.command = "help";
      commandSeen = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      if (commandSeen) {
        throw new Error("only one command may be provided");
      }
      options.command = "version";
      commandSeen = true;
      continue;
    }

    if (arg === "--human") {
      options.human = true;
      continue;
    }

    if (arg === "--json") {
      options.output = "json";
      options.outputExplicit = true;
      continue;
    }

    if (arg === "--yaml" || arg === "--yml") {
      options.output = "yaml";
      options.outputExplicit = true;
      continue;
    }

    if (arg === "--text") {
      options.output = "text";
      options.outputExplicit = true;
      continue;
    }

    if (arg === "--all") {
      options.allRequested = true;
      options.listFilterArgs.push("--all");
      if (options.command === "wait") {
        options.waitAllRunning = true;
      } else if (options.command === "reset") {
        throw new Error("reset full mode must use reset --full");
      } else {
        options.status = "all";
        options.hasListFilter = true;
      }
      continue;
    }

    if (arg === "--all-running") {
      options.waitAllRunning = true;
      options.waitOptionArgs.push("--all-running");
      continue;
    }

    if (arg === "--running") {
      options.status = "running";
      options.hasListFilter = true;
      options.listFilterArgs.push("--running");
      continue;
    }

    if (arg === "--stopped") {
      options.status = "stopped";
      options.hasListFilter = true;
      options.listFilterArgs.push("--stopped");
      continue;
    }

    if (arg === "--closed") {
      options.status = "closed";
      options.hasListFilter = true;
      options.listFilterArgs.push("--closed");
      continue;
    }

    if (arg === "--status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--status requires a value");
      }
      options.status = parseStatus(value);
      options.hasListFilter = true;
      options.listFilterArgs.push("--status");
      index += 1;
      continue;
    }

    if (arg.startsWith("--status=")) {
      options.status = parseStatus(arg.slice("--status=".length));
      options.hasListFilter = true;
      options.listFilterArgs.push("--status");
      continue;
    }

    if (arg === "--after-timestamp") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--after-timestamp requires a value");
      }
      options.afterTimestamp = parseUnixTimestamp(value, "--after-timestamp");
      options.hasListFilter = true;
      options.listFilterArgs.push("--after-timestamp");
      index += 1;
      continue;
    }

    if (arg.startsWith("--after-timestamp=")) {
      options.afterTimestamp = parseUnixTimestamp(arg.slice("--after-timestamp=".length), "--after-timestamp");
      options.hasListFilter = true;
      options.listFilterArgs.push("--after-timestamp");
      continue;
    }

    if (arg === "--medium") {
      if (options.command === "reset") {
        throw new Error("reset does not support --medium");
      }
      options.detail = "medium";
      options.detailExplicit = true;
      options.detailArgs.push("--medium");
      continue;
    }

    if (arg === "--full") {
      if (options.command === "reset") {
        options.resetFull = true;
        continue;
      }
      options.detail = "full";
      options.detailExplicit = true;
      options.detailArgs.push("--full");
      continue;
    }

    if (arg === "--detail") {
      if (options.command === "reset") {
        throw new Error("reset full mode must use reset --full");
      }
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--detail requires a value");
      }
      options.detail = parseDetail(value);
      options.detailExplicit = true;
      options.detailArgs.push("--detail");
      index += 1;
      continue;
    }

    if (arg.startsWith("--detail=")) {
      if (options.command === "reset") {
        throw new Error("reset full mode must use reset --full");
      }
      options.detail = parseDetail(arg.slice("--detail=".length));
      options.detailExplicit = true;
      options.detailArgs.push("--detail");
      continue;
    }

    if (arg === "--session" || arg === "-s") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--session requires a value");
      }
      options.session = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--session=")) {
      options.session = arg.slice("--session=".length);
      continue;
    }

    if (arg === "--cwd" || arg === "-C") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cwd requires a value");
      }
      options.cwd = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--cwd=")) {
      options.cwd = arg.slice("--cwd=".length);
      continue;
    }

    if (arg === "--agent" || arg === "--agent-id" || arg === "--subagent" || arg === "--subagent-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      options.agent = value;
      options.waitTargets.push(value);
      options.hasListFilter = true;
      index += 1;
      continue;
    }

    let parsedAgent = false;
    for (const prefix of ["--agent=", "--agent-id=", "--subagent=", "--subagent-id="]) {
      if (arg.startsWith(prefix)) {
        const value = arg.slice(prefix.length);
        options.agent = value;
        options.waitTargets.push(value);
        options.hasListFilter = true;
        parsedAgent = true;
        break;
      }
    }

    if (parsedAgent) {
      continue;
    }

    if (arg === "--timeout-ms" || arg === "--timeout") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      options.timeoutMs = parseMilliseconds(value, arg);
      options.waitOptionArgs.push(arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parseMilliseconds(arg.slice("--timeout-ms=".length), "--timeout-ms");
      options.waitOptionArgs.push("--timeout-ms");
      continue;
    }

    if (arg.startsWith("--timeout=")) {
      options.timeoutMs = parseMilliseconds(arg.slice("--timeout=".length), "--timeout");
      options.waitOptionArgs.push("--timeout");
      continue;
    }

    if (arg === "--interval-ms" || arg === "--poll-ms") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      options.intervalMs = parseMilliseconds(value, arg);
      options.waitOptionArgs.push(arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--interval-ms=")) {
      options.intervalMs = parseMilliseconds(arg.slice("--interval-ms=".length), "--interval-ms");
      options.waitOptionArgs.push("--interval-ms");
      continue;
    }

    if (arg.startsWith("--poll-ms=")) {
      options.intervalMs = parseMilliseconds(arg.slice("--poll-ms=".length), "--poll-ms");
      options.waitOptionArgs.push("--poll-ms");
      continue;
    }

    if (options.command === "wait" && !arg.startsWith("-")) {
      options.waitTargets.push(arg);
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  if ((options.command === "running" || options.command === "list") && options.afterTimestamp !== undefined) {
    options.status = "all";
  }

  validateCommandOptions(options);
  enforceHumanOverride(options);

  return options;
}

function validateCommandOptions(options: CliOptions): void {
  if (options.command === "help" || options.command === "version") {
    return;
  }

  if (options.command === "wait") {
    if (options.allRequested) {
      options.waitAllRunning = true;
    }
    const unsupportedListArg = options.listFilterArgs.find((arg) => arg !== "--all");
    if (unsupportedListArg) {
      throw new Error(`wait does not support ${unsupportedListArg}`);
    }
    if (options.detailArgs.length > 0) {
      throw new Error(`wait does not support ${options.detailArgs[0]}`);
    }
    return;
  }

  if (options.waitOptionArgs.length > 0) {
    throw new Error(`${options.waitOptionArgs[0]} is only supported by wait`);
  }

  if (options.command === "hook") {
    if (options.allRequested) {
      throw new Error("hook does not support --all");
    }
    if (options.listFilterArgs.length > 0) {
      throw new Error(`hook does not support ${options.listFilterArgs[0]}`);
    }
    if (options.detailArgs.length > 0) {
      throw new Error(`hook does not support ${options.detailArgs[0]}`);
    }
    if (options.outputExplicit) {
      throw new Error("hook does not support output format options");
    }
    if (options.session !== undefined) {
      throw new Error("hook does not support --session; hook session comes from stdin");
    }
    if (options.cwd !== undefined) {
      throw new Error("hook does not support --cwd; hook project comes from stdin cwd");
    }
    if (options.agent !== undefined) {
      throw new Error("hook does not support --agent");
    }
    if (options.human) {
      throw new Error("hook does not support --human");
    }
    return;
  }

  if (options.command === "debug") {
    if (options.allRequested) {
      throw new Error("debug does not support --all");
    }
    if (options.listFilterArgs.length > 0) {
      throw new Error(`debug does not support ${options.listFilterArgs[0]}`);
    }
    if (options.detailArgs.length > 0) {
      throw new Error(`debug does not support ${options.detailArgs[0]}`);
    }
    if (options.agent !== undefined) {
      throw new Error("debug does not support --agent");
    }
    return;
  }

  if (options.command !== "reset") {
    return;
  }

  if (options.allRequested) {
    throw new Error("reset full mode must use reset --full");
  }

  if (options.listFilterArgs.length > 0) {
    throw new Error(`reset does not support ${options.listFilterArgs[0]}`);
  }

  if (options.detailArgs.length > 0 && !options.fullBeforeReset) {
    throw new Error(`reset does not support ${options.detailArgs[0]}`);
  }
}

function enforceHumanOverride(options: CliOptions): void {
  if (options.command === "debug" && !options.human) {
    throw new Error("debug requires --human and is intended for manual diagnostics");
  }

  if (options.command === "reset" && options.agent && !options.human) {
    throw new Error("reset --agent requires --human and is intended for manual debugging");
  }

  if (options.command === "reset" && options.resetFull && !options.human) {
    throw new Error("reset --full requires --human and is intended for manual debugging");
  }

  if (options.command === "reset" && options.fullBeforeReset) {
    throw new Error("reset --full must be passed after reset");
  }

  if (options.command === "reset" && options.agent && options.resetFull) {
    throw new Error("reset --full cannot be combined with --agent");
  }

  if (options.human || (options.command !== "running" && options.command !== "list")) {
    return;
  }

  if (options.status === "all" || options.status === "closed") {
    throw new Error(`--status ${options.status} requires --human and is intended for manual debugging`);
  }
}

function parseStatus(value: string): "running" | "stopped" | "closed" | "all" {
  if (value === "running" || value === "stopped" || value === "closed" || value === "all") {
    return value;
  }

  throw new Error(`unsupported status filter: ${value}`);
}

function parseDetail(value: string): DetailLevel {
  if (value === "medium" || value === "full") {
    return value;
  }

  throw new Error(`unsupported detail level: ${value}`);
}

function effectiveDetail(options: CliOptions): DetailLevel {
  if (options.detailExplicit) {
    return options.detail;
  }

  return options.hasListFilter ? "compact" : "summary";
}

function parseMilliseconds(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} requires a non-negative number of milliseconds`);
  }

  return Math.floor(parsed);
}

function parseUnixTimestamp(value: string, label: string): number {
  if (value.length === 0) {
    throw new Error(`${label} requires a non-negative Unix timestamp in seconds`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`${label} requires a non-negative Unix timestamp in seconds`);
  }

  const milliseconds = parsed * 1000;
  if (!Number.isSafeInteger(milliseconds) || Number.isNaN(new Date(milliseconds).getTime())) {
    throw new Error(`${label} is outside the supported date range`);
  }

  return parsed;
}

async function waitForAgents(
  ledger: { listSession(sessionId: string, includeAll?: boolean): SubagentRun[] },
  sessionId: string,
  options: CliOptions
): Promise<WaitResult> {
  const startMs = Date.now();
  const reportedStopped = new Set<string>();
  let targets = uniqueStrings(options.waitTargets);
  if (targets.length === 0 || options.waitAllRunning) {
    const runningTargets = ledger
      .listSession(sessionId, true)
      .filter((run) => run.status === "running" && !run.closed)
      .map((run) => run.agentId ?? run.subagentId);
    targets = uniqueStrings([...targets, ...runningTargets]);
  }

  while (true) {
    const statuses = resolveWaitTargets(ledger.listSession(sessionId, true), sessionId, targets);
    writeWaitProgress(statuses, reportedStopped);
    const elapsedMs = Date.now() - startMs;
    const result = buildWaitResult(sessionId, statuses, options.timeoutMs, elapsedMs);
    if (result.summary.complete) {
      return result;
    }

    if (elapsedMs >= options.timeoutMs) {
      writeWaitTimeout(result.incompleteTargets);
      return result;
    }

    const remainingMs = options.timeoutMs - elapsedMs;
    await delay(Math.min(options.intervalMs, remainingMs));
  }
}

function reconcileCurrentSessionProcess(ledger: Pick<SubagentLedger, "reconcileSessionProcess">, sessionId: string, env: NodeJS.ProcessEnv): void {
  const codexSessionPid = currentCodexSessionPid(env);
  if (codexSessionPid === null) {
    return;
  }

  ledger.reconcileSessionProcess(sessionId, codexSessionPid);
}

function currentCodexSessionPid(env: NodeJS.ProcessEnv): number | null {
  const lineage = collectProcessLineage(process.pid);
  return resolveCodexSessionPid(lineage.slice(1), env).hookSessionPid;
}

function resolveWaitTargets(runs: SubagentRun[], sessionId: string, targets: string[]): WaitTargetStatus[] {
  return targets.map((target) => {
    const run = runs.find((candidate) => matchesRunTarget(candidate, sessionId, target));
    if (!run) {
      return {
        target,
        state: "missing",
        agentId: null,
        subagentId: null,
        runKey: null,
        agentType: null,
        closed: null,
        startTime: null,
        stopTime: null,
        durationMs: null,
        lastAssistantMessage: null
      };
    }

    return {
      target,
      state: run.status === "stopped" ? "stopped" : "running",
      agentId: run.agentId,
      subagentId: run.subagentId,
      runKey: run.runKey,
      agentType: run.agentType,
      closed: run.closed,
      startTime: run.startTime,
      stopTime: run.stopTime,
      durationMs: run.durationMs,
      lastAssistantMessage: run.lastAssistantMessage
    };
  });
}

function matchesRunTarget(run: SubagentRun, sessionId: string, target: string): boolean {
  return (
    run.agentId === target ||
    run.subagentId === target ||
    run.runKey === target ||
    run.runKey === `${sessionId}:${target}`
  );
}

function buildWaitResult(sessionId: string, targets: WaitTargetStatus[], timeoutMs: number, elapsedMs: number): WaitResult {
  const incompleteTargets = targets.filter((target) => target.state !== "stopped");
  const stopped = targets.filter((target) => target.state === "stopped").length;
  const running = targets.filter((target) => target.state === "running").length;
  const missing = targets.filter((target) => target.state === "missing").length;
  return {
    summary: {
      sessionId,
      complete: running === 0 && missing === 0,
      total: targets.length,
      stopped,
      running,
      missing,
      timeoutMs,
      elapsedMs
    },
    incompleteTargets,
    targets
  };
}

function writeWaitProgress(targets: WaitTargetStatus[], reportedStopped: Set<string>): void {
  for (const target of targets) {
    if (target.state !== "stopped" || reportedStopped.has(target.target)) {
      continue;
    }

    reportedStopped.add(target.target);
    const agentId = target.agentId ?? target.subagentId;
    if (!agentId) {
      continue;
    }

    const type = target.agentType ? ` type=${target.agentType}` : "";
    process.stderr.write(`[subagent-auto-manager] wait stopped agentId=${agentId}${type}\n`);
  }
}

function writeWaitTimeout(targets: WaitTargetStatus[]): void {
  for (const target of targets) {
    const type = target.agentType ? ` type=${target.agentType}` : "";
    if (target.agentId ?? target.subagentId) {
      process.stderr.write(`[subagent-auto-manager] wait timeout agentId=${target.agentId ?? target.subagentId} state=${target.state}${type}\n`);
    } else {
      process.stderr.write(`[subagent-auto-manager] wait timeout target=${target.target} state=${target.state}\n`);
    }
  }
}

function writeWaitResult(result: WaitResult, output: "json" | "yaml" | "text"): void {
  if (output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (output === "yaml") {
    process.stdout.write(toYaml(result));
    return;
  }

  process.stdout.write(formatWaitResult(result));
}

function buildDebugReport(runs: SubagentRun[], summary: unknown, sessionId: string, projectRoot: string, env: NodeJS.ProcessEnv): DebugReport {
  const lineage = collectProcessLineage(process.pid);
  const ancestors = lineage.slice(1);
  const resolution = resolveCodexSessionPid(ancestors, env);
  const processLineage = lineage.map((processInfo, index) => ({
    depth: index,
    pid: processInfo.pid,
    parentPid: processInfo.parentPid,
    name: processInfo.name,
    commandLine: processInfo.commandLine,
    isCodex: isCodexProcess(processInfo)
  }));
  const codexSessionPid = resolution.hookSessionPid;
  const directParentPid = lineage[0]?.parentPid ?? process.ppid;
  const directParent = processLineage.find((processInfo) => processInfo.pid === directParentPid);
  const recentRuns = runs.slice(0, 10).map((run) => ({
    runKey: run.runKey,
    agentId: run.agentId,
    subagentId: run.subagentId,
    state: publicRunState(run),
    codexSessionPid: run.hookSessionPid,
    hookParentPid: run.hookParentPid,
    hookSessionPid: run.hookSessionPid,
    startTime: run.startTime,
    stopTime: run.stopTime,
    stopEventId: run.stopEventId,
    stopPayloadPresent: run.stopPayload !== null
  }));
  const notes = debugNotes(resolution.hookSessionPid, resolution.source, processLineage, directParent);

  return {
    generatedAt: new Date().toISOString(),
    command: "debug",
    environment: {
      platform: process.platform,
      pid: process.pid,
      ppid: process.ppid,
      CODEX_PID: env.CODEX_PID ?? null,
      CODEX_THREAD_ID: env.CODEX_THREAD_ID ?? null,
      CODEX_MANAGED_BY_NPM: env.CODEX_MANAGED_BY_NPM ?? null,
      CODEX_MANAGED_PACKAGE_ROOT: env.CODEX_MANAGED_PACKAGE_ROOT ?? null
    },
    processIdentity: {
      codexSessionPid,
      codexSessionPidSource: resolution.source,
      hookParentPid: codexSessionPid,
      hookSessionPid: resolution.hookSessionPid,
      hookSessionPidSource: resolution.source,
      envCodexPid: resolution.envCodexPid,
      recursiveCodexPid: resolution.recursiveCodexPid,
      directParentIsCodex: directParent?.isCodex ?? false,
      codexAncestorCount: processLineage.filter((processInfo) => processInfo.depth > 0 && processInfo.isCodex).length
    },
    processLineage,
    ledger: {
      projectRoot,
      sessionId,
      summary,
      recentRuns,
      pidGroups: {
        codexSessionPid: pidGroups(runs.map((run) => run.hookSessionPid)),
        hookParentPid: pidGroups(runs.map((run) => run.hookParentPid)),
        hookSessionPid: pidGroups(runs.map((run) => run.hookSessionPid))
      }
    },
    assessment: {
      ppidMatchesCodex: directParent?.isCodex ?? false,
      sessionPidResolved: resolution.hookSessionPid !== null,
      staleDetectionAvailable: resolution.hookSessionPid !== null,
      notes
    }
  };
}

function writeDebugReport(report: DebugReport, output: "json" | "yaml" | "text"): void {
  if (output === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (output === "yaml") {
    process.stdout.write(toYaml(report));
    return;
  }

  process.stdout.write(formatDebugReport(report));
}

function formatDebugReport(report: DebugReport): string {
  const identity = report.processIdentity;
  const lines = [
    `debug generated=${report.generatedAt}`,
    `env CODEX_PID=${report.environment.CODEX_PID ?? "null"} CODEX_THREAD_ID=${report.environment.CODEX_THREAD_ID ?? "null"} managed_by_npm=${report.environment.CODEX_MANAGED_BY_NPM ?? "null"}`,
    `process pid=${report.environment.pid} ppid=${report.environment.ppid} codexSessionPid=${identity.codexSessionPid ?? "null"} source=${identity.codexSessionPidSource ?? "null"} recursiveCodexPid=${identity.recursiveCodexPid ?? "null"}`,
    `assessment ppidMatchesCodex=${report.assessment.ppidMatchesCodex} sessionPidResolved=${report.assessment.sessionPidResolved} staleDetectionAvailable=${report.assessment.staleDetectionAvailable}`,
    `ledger project=${report.ledger.projectRoot} session=${report.ledger.sessionId}`,
    "process lineage:"
  ];

  for (const row of report.processLineage) {
    lines.push(`  [${row.depth}] pid=${row.pid} ppid=${row.parentPid ?? "null"} codex=${row.isCodex} name=${row.name ?? "null"} cmd=${row.commandLine ?? "null"}`);
  }

  lines.push("ledger codexSessionPid groups:");
  for (const group of report.ledger.pidGroups.codexSessionPid) {
    lines.push(`  pid=${group.pid ?? "null"} count=${group.count}`);
  }

  lines.push("notes:");
  for (const note of report.assessment.notes) {
    lines.push(`  - ${note}`);
  }

  return `${lines.join("\n")}\n`;
}

function debugNotes(
  hookSessionPid: number | null,
  source: "CODEX_PID" | "ppid-chain" | null,
  processLineage: DebugProcessRow[],
  directParent: DebugProcessRow | undefined
): string[] {
  const notes: string[] = [];
  if (directParent?.isCodex) {
    notes.push("The direct parent process is recognized as Codex.");
  } else {
    notes.push("The direct parent process is not recognized as Codex.");
  }

  if (hookSessionPid === null) {
    notes.push("No Codex session PID was resolved; stale pid-change detection will not run for this hook invocation.");
  } else if (source === "CODEX_PID") {
    notes.push("Codex session PID came from CODEX_PID.");
  } else if (source === "ppid-chain") {
    notes.push("Codex session PID came from recursive ppid-chain lookup.");
  }

  if (processLineage.length === 0) {
    notes.push("Process lineage collection returned no rows.");
  }

  return notes;
}

function pidGroups(values: Array<number | null>): Array<{ pid: number | null; count: number }> {
  const counts = new Map<string, { pid: number | null; count: number }>();
  for (const pid of values) {
    const key = pid === null ? "null" : String(pid);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { pid, count: 1 });
    }
  }

  return [...counts.values()].sort((left, right) => right.count - left.count);
}

function formatWaitResult(result: WaitResult): string {
  const summary = result.summary;
  const lines = [
    summary.complete
      ? `wait complete session=${summary.sessionId} targets=${summary.total} elapsed_ms=${summary.elapsedMs}`
      : `wait timeout session=${summary.sessionId} targets=${summary.total} stopped=${summary.stopped} running=${summary.running} missing=${summary.missing} elapsed_ms=${summary.elapsedMs} timeout_ms=${summary.timeoutMs}`
  ];

  const visibleTargets = summary.complete ? result.targets : result.incompleteTargets;
  for (const target of visibleTargets) {
    const label = target.state === "stopped" ? "Stopped" : target.state === "running" ? "Pending" : "Miss";
    const name = target.agentId ?? target.subagentId ?? target.target;
    const type = target.agentType ? ` ${target.agentType}` : "";
    lines.push(`${label} ${name}${type}`);
  }

  return `${lines.join("\n")}\n`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

function filterRuns(
  runs: SubagentRun[],
  sessionId: string,
  status: "running" | "stopped" | "closed" | "all",
  afterTimestamp?: number,
  agent?: string
): SubagentRun[] {
  const statusFiltered =
    status === "all"
      ? runs
      : runs.filter((run) => publicRunState(run) === status);

  const agentFiltered = agent === undefined ? statusFiltered : statusFiltered.filter((run) => matchesRunTarget(run, sessionId, agent));

  if (afterTimestamp === undefined) {
    return agentFiltered;
  }

  const afterMs = afterTimestamp * 1000;
  return agentFiltered.filter((run) => new Date(run.startTime).getTime() > afterMs);
}

function writeHints(
  options: CliOptions,
  sessionId: string,
  shown: number,
  total: number
): void {
  const detail = effectiveDetail(options);
  const pieces = [
    `filter=${options.status}`,
    `format=${options.output}`,
    `detail=${detail}`,
    `session=${sessionId}`
  ];
  if (options.afterTimestamp !== undefined) {
    pieces.push(`after_timestamp=${options.afterTimestamp}`);
  }
  if (options.agent !== undefined && (options.command === "running" || options.command === "list")) {
    pieces.push(`agent=${options.agent}`);
  }
  process.stderr.write(`[subagent-auto-manager] ${pieces.join(" ")} shown=${shown}/${total}\n`);

  const base = "npx -y subagent-auto-manager@latest";
  if (options.status === "running") {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} wait --timeout-ms 600000 --text\` to wait for the current running agents, or \`${base} --status stopped\` for completed agent ids.\n`);
  } else if (options.status === "stopped") {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} --running\` for active agent ids.\n`);
  } else if (options.status === "closed") {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} reset --agent <id> --human\` to clear one closed mark.\n`);
  } else {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} --running\` for active agents only, or add \`--full\` for all stored fields.\n`);
  }
}

function helpText(): string {
  return `Usage:
  subagent-auto-manager [running|list] [--session <id>] [--cwd <project>] [--agent <id>] [--status running|stopped|closed|all] [--after-timestamp <unix-seconds>] [--json|--yaml|--text] [--detail medium|full]
  subagent-auto-manager reset [--full --human] [--agent <id> --human] [--session <id>] [--cwd <project>] [--json|--yaml|--text]
  subagent-auto-manager wait [agent-id ...] [--all] [--timeout-ms <ms>] [--interval-ms <ms>] [--session <id>] [--cwd <project>] [--json|--yaml|--text]
  subagent-auto-manager debug --human [--session <id>] [--cwd <project>] [--json|--yaml|--text]
  subagent-auto-manager hook

Defaults:
  --session defaults to CODEX_THREAD_ID.
  --cwd defaults to the current working directory.
  Output defaults to JSON. Use --yaml for YAML.
  Detail defaults to summary with no list/filter arguments, and compact for list/filter arguments.
  Use --medium for recall fields, or --full/--detail full for all stored fields and raw payloads.
  With no list/filter arguments, JSON/YAML output hides runs and returns only summary.
  With list/filter arguments, default JSON/YAML runs include agentId, state, and stopReason when stopped.
  Status defaults to running. Use --status stopped to list stopped agent ids.
  --agent filters list/running output by agentId, subagentId, runKey, or <session>:<agent-id>.
  Broad all/closed listing and --after-timestamp are manual debugging queries.
  reset marks stopped, not-closed agents as closed. reset --full --human marks running and stopped, not-closed agents as closed. With --agent and --human, reset clears one closed mark for manual debugging.
  wait polls the hook ledger until every target is stopped. During polling, newly stopped agent ids stream to stderr. With no explicit targets, wait snapshots current running, not-closed agents.
  debug prints a human diagnostics report for CODEX_PID, recursive ppid Codex detection, process lineage, and ledger PID groups.

Hook config command:
  npx -y subagent-auto-manager@latest hook
`;
}

function packageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(here, "..", "package.json");
  const raw = readFileSync(packagePath, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
