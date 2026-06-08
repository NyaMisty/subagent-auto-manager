export const SUPPORTED_EVENTS = ["SubagentStart", "SubagentStop", "PostToolUse"] as const;

export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  [key: string]: unknown;
}

export interface SubagentRun {
  runKey: string;
  subagentId: string;
  agentId: string | null;
  agentType: string | null;
  sessionId: string;
  codexSessionPid: number | null;
  hookParentPid: number | null;
  hookSessionPid: number | null;
  turnId: string | null;
  permissionMode: string | null;
  model: string | null;
  cwd: string | null;
  transcriptPath: string | null;
  agentTranscriptPath: string | null;
  startEventId: number;
  stopEventId: number | null;
  startTime: string;
  stopTime: string | null;
  status: "running" | "stopped";
  closed: boolean;
  closeEventId: number | null;
  closeTime: string | null;
  durationMs: number | null;
  prompt: string | null;
  lastAssistantMessage: string | null;
  startArgs: string | null;
  startPayload: string;
  stopPayload: string | null;
  closePayload: string | null;
}

export interface SessionSummary {
  sessionId: string;
  running: number;
  stopped: number;
  closed: number;
  total: number;
}
