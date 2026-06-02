import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const CODEX_DIR = ".codex";
export const DB_DIR_NAME = "subagent_auto_manager.db";
export const DB_FILE_NAME = "ledger.sqlite3";

export function projectRootFrom(input?: { cwd?: unknown }, fallback = process.cwd()): string {
  const cwd = typeof input?.cwd === "string" && input.cwd.length > 0 ? input.cwd : fallback;
  return resolve(cwd);
}

export function databaseDirectory(projectRoot = process.cwd()): string {
  return resolve(projectRoot, CODEX_DIR, DB_DIR_NAME);
}

export function databasePath(projectRoot = process.cwd()): string {
  return resolve(databaseDirectory(projectRoot), DB_FILE_NAME);
}

export function ensureDatabaseDirectory(projectRoot = process.cwd()): string {
  const dir = databaseDirectory(projectRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}
