export const SUPPORTED_EVENTS = ["SubagentStart", "SubagentStop"] as const;

export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

export interface SubagentRun {
  runKey: string;
  subagentId: string;
  agentId: string | null;
  agentType: string | null;
  sessionId: string;
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
  durationMs: number | null;
  prompt: string | null;
  lastAssistantMessage: string | null;
  startPayload: string;
  stopPayload: string | null;
}

export interface SessionSummary {
  sessionId: string;
  running: number;
  stopped: number;
  total: number;
}
