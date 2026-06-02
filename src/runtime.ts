import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectEntry(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }

  return resolve(fileURLToPath(importMetaUrl)) === resolve(argvPath);
}

export function suppressSqliteExperimentalWarning(): void {
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const text = warning instanceof Error ? warning.message : warning;
    if (String(text).includes("SQLite is an experimental feature")) {
      return;
    }

    return emitWarning(warning as string, ...(args as Parameters<typeof process.emitWarning> extends [unknown, ...infer Rest] ? Rest : never));
  }) as typeof process.emitWarning;
}
