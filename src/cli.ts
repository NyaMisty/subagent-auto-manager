#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRootFrom } from "./paths.js";
import { isDirectEntry } from "./runtime.js";
import { sessionIdFromEnv } from "./session.js";
import { formatSession } from "./format.js";
import { buildOutput, type DetailLevel } from "./output.js";
import { toYaml } from "./yaml.js";
import type { SubagentRun } from "./types.js";

interface CliOptions {
  command: "list" | "running" | "reset" | "hook" | "help" | "version";
  session?: string;
  cwd?: string;
  agent?: string;
  output: "json" | "yaml" | "text";
  detail: DetailLevel;
  status: "running" | "stopped" | "closed" | "all";
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
    const { runHook } = await import("./hook.js");
    await runHook();
    return;
  }

  const sessionId = options.session ?? sessionIdFromEnv(env);
  const projectRoot = projectRootFrom({ cwd: options.cwd });
  const { SubagentLedger } = await import("./ledger.js");
  const ledger = SubagentLedger.open(projectRoot);

  try {
    if (options.command === "reset") {
      const result = ledger.resetClosed(sessionId, options.agent);
      if (options.output === "json") {
        process.stdout.write(`${JSON.stringify({ sessionId, agentId: options.agent ?? null, ...result }, null, 2)}\n`);
      } else if (options.output === "yaml") {
        process.stdout.write(toYaml({ sessionId, agentId: options.agent ?? null, ...result }));
      } else {
        const target = options.agent ? ` agent=${options.agent}` : "";
        process.stdout.write(`reset closed session=${sessionId}${target} matched=${result.matched} reset=${result.reset}\n`);
      }
      return;
    }

    const summary = ledger.summary(sessionId);
    const runs = filterRuns(ledger.listSession(sessionId, true), options.status);
    const result = buildOutput(summary, runs, options.detail);
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
    output: "json",
    detail: "medium",
    status: "running"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "list" || arg === "running" || arg === "reset" || arg === "hook") {
      options.command = arg;
      if (arg === "list") {
        options.status = "all";
      }
      if (arg === "running") {
        options.status = "running";
      }
      continue;
    }

    if (arg === "help" || arg === "--help" || arg === "-h") {
      options.command = "help";
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      options.command = "version";
      continue;
    }

    if (arg === "--json") {
      options.output = "json";
      continue;
    }

    if (arg === "--yaml" || arg === "--yml") {
      options.output = "yaml";
      continue;
    }

    if (arg === "--text") {
      options.output = "text";
      continue;
    }

    if (arg === "--all") {
      options.status = "all";
      continue;
    }

    if (arg === "--running") {
      options.status = "running";
      continue;
    }

    if (arg === "--stopped") {
      options.status = "stopped";
      continue;
    }

    if (arg === "--closed") {
      options.status = "closed";
      continue;
    }

    if (arg === "--status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--status requires a value");
      }
      options.status = parseStatus(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--status=")) {
      options.status = parseStatus(arg.slice("--status=".length));
      continue;
    }

    if (arg === "--medium") {
      options.detail = "medium";
      continue;
    }

    if (arg === "--full") {
      options.detail = "full";
      continue;
    }

    if (arg === "--detail") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--detail requires a value");
      }
      options.detail = parseDetail(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--detail=")) {
      options.detail = parseDetail(arg.slice("--detail=".length));
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
      index += 1;
      continue;
    }

    let parsedAgent = false;
    for (const prefix of ["--agent=", "--agent-id=", "--subagent=", "--subagent-id="]) {
      if (arg.startsWith(prefix)) {
        options.agent = arg.slice(prefix.length);
        parsedAgent = true;
        break;
      }
    }

    if (parsedAgent) {
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
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

function filterRuns(runs: SubagentRun[], status: "running" | "stopped" | "closed" | "all"): SubagentRun[] {
  if (status === "all") {
    return runs;
  }

  if (status === "closed") {
    return runs.filter((run) => run.closed);
  }

  return runs.filter((run) => run.status === status && (status !== "running" || !run.closed));
}

function writeHints(
  options: CliOptions,
  sessionId: string,
  shown: number,
  total: number
): void {
  const pieces = [
    `filter=${options.status}`,
    `format=${options.output}`,
    `detail=${options.detail}`,
    `session=${sessionId}`
  ];
  process.stderr.write(`[subagent-auto-manager] ${pieces.join(" ")} shown=${shown}/${total}\n`);

  const base = "npx -y subagent-auto-manager";
  if (options.status === "running") {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} --all\` to include stopped agents, \`${base} --stopped\` for completed agents, or \`${base} --closed\` for closed threads.\n`);
  } else if (options.status === "stopped") {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} --running\` for active agents, or \`${base} --all\` for the full session list.\n`);
  } else if (options.status === "closed") {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} reset --agent <id>\` to clear one closed mark, or \`${base} reset\` to clear closed marks for the session.\n`);
  } else {
    process.stderr.write(`[subagent-auto-manager] next: use \`${base} --running\` for active agents only, or add \`--full\` for all stored fields.\n`);
  }
}

function helpText(): string {
  return `Usage:
  subagent-auto-manager [running|list] [--session <id>] [--cwd <project>] [--status running|stopped|closed|all] [--json|--yaml|--text] [--detail medium|full]
  subagent-auto-manager reset [--agent <id>] [--session <id>] [--cwd <project>] [--json|--yaml|--text]
  subagent-auto-manager hook

Defaults:
  --session defaults to CODEX_THREAD_ID.
  --cwd defaults to the current working directory.
  Output defaults to JSON. Use --yaml for YAML.
  Detail defaults to medium. Use --full or --detail full for all stored fields and raw payloads.
  Status defaults to running. Use --all or list to include stopped agents. Use --closed to list closed agent threads.
  reset clears closed marks for the current session, or one agent when --agent is provided.

Hook config command:
  npx -y subagent-auto-manager hook
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
