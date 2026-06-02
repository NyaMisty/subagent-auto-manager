import type { HookInput } from "./types.js";

export function sessionIdFromHook(input: HookInput): string {
  if (typeof input.session_id !== "string" || input.session_id.length === 0) {
    throw new Error("hook input is missing session_id");
  }

  return input.session_id;
}

export function sessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.CODEX_THREAD_ID;
  if (!value) {
    throw new Error("CODEX_THREAD_ID is required when no --session is provided");
  }

  return value;
}
