#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectRootFrom } from "./paths.js";
import { isDirectEntry } from "./runtime.js";
import { sessionIdFromEnv } from "./session.js";
import { formatSession } from "./format.js";
import { toYaml } from "./yaml.js";

interface CliOptions {
  command: "list" | "running" | "hook" | "help" | "version";
  session?: string;
  cwd?: string;
  output: "json" | "yaml" | "text";
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
    const includeAll = options.command === "list";
    const runs = ledger.listSession(sessionId, includeAll);
    const summary = ledger.summary(sessionId);
    const result = { summary, runs };
    if (options.output === "json") {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (options.output === "yaml") {
      process.stdout.write(toYaml(result));
    } else {
      process.stdout.write(formatSession(summary, runs));
    }
  } finally {
    ledger.close();
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: "list",
    output: "json"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "list" || arg === "running" || arg === "hook") {
      options.command = arg;
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

    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function helpText(): string {
  return `Usage:
  subagent-auto-manager [list] [--session <id>] [--cwd <project>] [--json|--yaml|--text]
  subagent-auto-manager running [--session <id>] [--cwd <project>] [--json|--yaml|--text]
  subagent-auto-manager hook

Defaults:
  --session defaults to CODEX_THREAD_ID.
  --cwd defaults to the current working directory.
  Output defaults to JSON. Use --yaml for YAML.

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
