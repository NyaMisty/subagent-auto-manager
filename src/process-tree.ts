import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProcessInfo {
  pid: number;
  parentPid: number | null;
  name: string | null;
  commandLine: string | null;
}

export interface HookProcessIdentity {
  hookParentPid: number | null;
  hookSessionPid: number | null;
  hookAncestorPids: number[];
}

export type CodexSessionPidSource = "CODEX_PID" | "ppid-chain" | null;

export interface CodexSessionPidResolution {
  hookSessionPid: number | null;
  source: CodexSessionPidSource;
  envCodexPid: number | null;
  recursiveCodexPid: number | null;
}

const MAX_DEPTH = 24;

export function currentHookProcessIdentity(): HookProcessIdentity {
  const lineage = collectProcessLineage(process.pid);
  const ancestors = lineage.slice(1);
  const hookAncestorPids = ancestors.map((ancestor) => ancestor.pid);
  const resolution = resolveCodexSessionPid(ancestors);

  return {
    hookParentPid: resolution.hookSessionPid,
    hookSessionPid: resolution.hookSessionPid,
    hookAncestorPids
  };
}

export function collectProcessLineage(pid: number, maxDepth = MAX_DEPTH): ProcessInfo[] {
  const normalizedPid = normalizePid(pid);
  if (normalizedPid === null) {
    return [];
  }

  if (process.platform === "win32") {
    return collectWindowsProcessLineage(normalizedPid, maxDepth);
  }

  if (existsSync("/proc")) {
    return collectProcProcessLineage(normalizedPid, maxDepth);
  }

  return collectPsProcessLineage(normalizedPid, maxDepth);
}

export function findCodexAncestorPid(lineage: ProcessInfo[]): number | null {
  for (const processInfo of lineage) {
    if (isCodexProcess(processInfo)) {
      return processInfo.pid;
    }
  }

  return null;
}

export function resolveCodexSessionPid(lineage: ProcessInfo[], env: NodeJS.ProcessEnv = process.env): CodexSessionPidResolution {
  const envCodexPid = normalizePid(env.CODEX_PID);
  const recursiveCodexPid = findCodexAncestorPid(lineage);
  if (envCodexPid !== null) {
    return {
      hookSessionPid: envCodexPid,
      source: "CODEX_PID",
      envCodexPid,
      recursiveCodexPid
    };
  }

  return {
    hookSessionPid: recursiveCodexPid,
    source: recursiveCodexPid === null ? null : "ppid-chain",
    envCodexPid,
    recursiveCodexPid
  };
}

function collectWindowsProcessLineage(pid: number, maxDepth: number): ProcessInfo[] {
  const script = `
$targetPid = ${pid}
$maxDepth = ${maxDepth}
$processes = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine
$byPid = @{}
foreach ($process in $processes) {
  $byPid[[int]$process.ProcessId] = $process
}
$rows = @()
for ($i = 0; $i -lt $maxDepth -and $targetPid -gt 0; $i++) {
  $process = $byPid[[int]$targetPid]
  if ($null -eq $process) { break }
  $rows += [PSCustomObject]@{
    pid = [int]$process.ProcessId
    parentPid = if ($null -eq $process.ParentProcessId) { $null } else { [int]$process.ParentProcessId }
    name = [string]$process.Name
    commandLine = if ($null -eq $process.CommandLine) { $null } else { [string]$process.CommandLine }
  }
  $targetPid = [int]$process.ParentProcessId
}
$rows | ConvertTo-Json -Compress
`;

  try {
    const stdout = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    }).trim();
    if (stdout.length === 0) {
      return [];
    }

    const parsed = JSON.parse(stdout) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(processInfoFromUnknown).filter((row): row is ProcessInfo => row !== null);
  } catch {
    return [];
  }
}

function collectProcProcessLineage(pid: number, maxDepth: number): ProcessInfo[] {
  const lineage: ProcessInfo[] = [];
  let currentPid: number | null = pid;
  const seen = new Set<number>();

  for (let depth = 0; depth < maxDepth && currentPid !== null && !seen.has(currentPid); depth += 1) {
    seen.add(currentPid);
    const processInfo = readProcProcessInfo(currentPid);
    if (!processInfo) {
      break;
    }

    lineage.push(processInfo);
    currentPid = processInfo.parentPid;
  }

  return lineage;
}

function readProcProcessInfo(pid: number): ProcessInfo | null {
  try {
    const status = readFileSync(join("/proc", String(pid), "status"), "utf8");
    const parentMatch = /^PPid:\s+(\d+)$/m.exec(status);
    const nameMatch = /^Name:\s+(.+)$/m.exec(status);
    const commandLine = readFileSync(join("/proc", String(pid), "cmdline"), "utf8").replace(/\0/g, " ").trim();
    return {
      pid,
      parentPid: normalizePid(parentMatch?.[1]),
      name: nameMatch?.[1] ?? null,
      commandLine: commandLine.length > 0 ? commandLine : null
    };
  } catch {
    return null;
  }
}

function collectPsProcessLineage(pid: number, maxDepth: number): ProcessInfo[] {
  const lineage: ProcessInfo[] = [];
  let currentPid: number | null = pid;
  const seen = new Set<number>();

  for (let depth = 0; depth < maxDepth && currentPid !== null && !seen.has(currentPid); depth += 1) {
    seen.add(currentPid);
    const processInfo = readPsProcessInfo(currentPid);
    if (!processInfo) {
      break;
    }

    lineage.push(processInfo);
    currentPid = processInfo.parentPid;
  }

  return lineage;
}

function readPsProcessInfo(pid: number): ProcessInfo | null {
  try {
    const stdout = execFileSync("ps", ["-p", String(pid), "-o", "pid=", "-o", "ppid=", "-o", "comm=", "-o", "args="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000
    }).trim();
    const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().length > 0);
    if (!line) {
      return null;
    }

    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!match) {
      return null;
    }

    return {
      pid: Number(match[1]),
      parentPid: normalizePid(match[2]),
      name: match[3] ?? null,
      commandLine: match[4]?.trim() || null
    };
  } catch {
    return null;
  }
}

function processInfoFromUnknown(value: unknown): ProcessInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  const pid = normalizePid(value.pid);
  if (pid === null) {
    return null;
  }

  return {
    pid,
    parentPid: normalizePid(value.parentPid),
    name: stringOrNull(value.name),
    commandLine: stringOrNull(value.commandLine)
  };
}

export function isCodexProcess(processInfo: ProcessInfo): boolean {
  const name = processInfo.name?.toLowerCase() ?? "";
  const commandLine = processInfo.commandLine?.toLowerCase() ?? "";
  const normalizedCommand = commandLine.replace(/\\/g, "/");
  const candidateNames = [name, ...commandTokens(commandLine)].map(baseProcessName);

  return (
    candidateNames.some((candidate) => candidate === "codex" || candidate === "codex-cli") ||
    /(?:^|[\/\s])@openai\/codex(?:[\/\s]|$)/.test(normalizedCommand) ||
    /(?:^|[\/\s])codex-cli(?:[\/\s]|$)/.test(normalizedCommand)
  );
}

function commandTokens(commandLine: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]+)"|'([^']+)'|(\S+)/g;
  for (const match of commandLine.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }

  return tokens;
}

function baseProcessName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\\/g, "/");
  const baseName = normalized.split("/").pop() ?? normalized;
  return baseName.replace(/\.(?:exe|cmd|ps1|bat)$/u, "");
}

function normalizePid(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
