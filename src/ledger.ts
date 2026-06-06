import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { compactJson } from "./json.js";
import { databasePath } from "./paths.js";
import { suppressSqliteExperimentalWarning } from "./runtime.js";
import type { HookInput, SessionSummary, SubagentRun, SupportedEvent } from "./types.js";

suppressSqliteExperimentalWarning();
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
type DatabaseSyncInstance = InstanceType<typeof DatabaseSync>;
type SQLInputValue = import("node:sqlite").SQLInputValue;

interface EventRow {
  id: number;
  event_name: string;
  session_id: string;
  turn_id: string | null;
  subagent_id: string;
  agent_id: string | null;
  agent_type: string | null;
  permission_mode: string | null;
  model: string | null;
  cwd: string | null;
  transcript_path: string | null;
  agent_transcript_path: string | null;
  prompt: string | null;
  last_assistant_message: string | null;
  start_args_json: string | null;
  stop_hook_active: number | null;
  tool_name: string | null;
  tool_use_id: string | null;
  close_target: string | null;
  payload_json: string;
  created_at: string;
}

interface RunRow {
  run_key: string;
  subagent_id: string;
  agent_id: string | null;
  agent_type: string | null;
  session_id: string;
  turn_id: string | null;
  permission_mode: string | null;
  model: string | null;
  cwd: string | null;
  transcript_path: string | null;
  agent_transcript_path: string | null;
  start_event_id: number;
  stop_event_id: number | null;
  start_time: string;
  stop_time: string | null;
  status: "running" | "stopped";
  closed: number;
  close_event_id: number | null;
  close_time: string | null;
  duration_ms: number | null;
  prompt: string | null;
  last_assistant_message: string | null;
  start_args_json: string | null;
  start_payload: string;
  stop_payload: string | null;
  close_payload: string | null;
}

interface SummaryRow {
  session_id: string;
  running: number;
  stopped: number;
  closed: number;
  total: number;
}

export interface LedgerRecordInput {
  eventName: SupportedEvent;
  sessionId: string;
  projectRoot: string;
  payload: HookInput;
}

export interface LedgerRecordResult {
  eventId: number;
  subagentId: string;
  recorded?: boolean;
}

export interface ResetClosedResult {
  matched: number;
  reset: number;
}

export interface CloseStoppedResult {
  matched: number;
  closed: number;
}

export class SubagentLedger {
  private db: DatabaseSyncInstance;

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  static open(projectRoot = process.cwd()): SubagentLedger {
    return new SubagentLedger(databasePath(projectRoot));
  }

  close(): void {
    this.db.close();
  }

  record(input: LedgerRecordInput): LedgerRecordResult {
    const now = new Date().toISOString();
    const payloadJson = compactJson(input.payload);
    const fields = extractFields(input.payload, input.projectRoot, input.eventName);
    const toolStateChange = toolStateChangeFromPayload(input.eventName, input.payload);
    if (input.eventName === "PostToolUse" && !toolStateChange) {
      return {
        eventId: 0,
        subagentId: fields.agentId ?? "",
        recorded: false
      };
    }

    const runKey = this.resolveRunKey(input.eventName, input.sessionId, fields, payloadJson, toolStateChange);
    const subagentId = fields.agentId ?? toolStateChange?.target ?? runKey;

    const eventId = this.insertEvent({
      eventName: input.eventName,
      sessionId: input.sessionId,
      runKey,
      subagentId,
      fields,
      closeTarget: toolStateChange?.target ?? null,
      payloadJson,
      createdAt: now
    });

    if (input.eventName === "SubagentStart") {
      this.upsertStart({
        runKey,
        sessionId: input.sessionId,
        subagentId,
        fields,
        startEventId: eventId,
        startTime: now,
        startPayload: payloadJson
      });
    } else if (input.eventName === "SubagentStop") {
      this.applyStop({
        runKey,
        sessionId: input.sessionId,
        subagentId,
        fields,
        stopEventId: eventId,
        stopTime: now,
        stopPayload: payloadJson
      });
    } else if (toolStateChange?.kind === "close") {
      this.applyClose({
        runKey,
        closeEventId: eventId,
        closeTime: now,
        closePayload: payloadJson
      });
    } else if (toolStateChange?.kind === "resume") {
      this.resetClosedByRunKey(runKey);
    }

    return { eventId, subagentId, recorded: true };
  }

  closeStopped(sessionId: string): CloseStoppedResult {
    const now = new Date().toISOString();
    const matched = this.db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM subagent_runs
          WHERE session_id = ?
            AND status = 'stopped'
            AND closed = 0`
      )
      .get(sessionId) as { count: number };

    const result = this.db
      .prepare(
        `UPDATE subagent_runs
            SET closed = 1,
                close_event_id = NULL,
                close_time = ?,
                close_payload = NULL,
                updated_at = ?
          WHERE session_id = ?
            AND status = 'stopped'
            AND closed = 0`
      )
      .run(now, now, sessionId);

    return {
      matched: Number(matched.count),
      closed: Number(result.changes)
    };
  }

  resetClosed(sessionId: string, agentId: string): ResetClosedResult {
    const params: SQLInputValue[] = [sessionId, agentId, agentId, `${sessionId}:${agentId}`];
    const filter = "session_id = ? AND (agent_id = ? OR subagent_id = ? OR run_key = ?)";

    const matched = this.db
      .prepare(`SELECT COUNT(*) AS count FROM subagent_runs WHERE ${filter}`)
      .get(...params) as { count: number };
    const result = this.db
      .prepare(
        `UPDATE subagent_runs
            SET closed = 0,
                close_event_id = NULL,
                close_time = NULL,
                close_payload = NULL,
                updated_at = ?
          WHERE ${filter}
            AND closed = 1`
      )
      .run(new Date().toISOString(), ...params);

    return {
      matched: Number(matched.count),
      reset: Number(result.changes)
    };
  }

  listSession(sessionId: string, includeAll = true): SubagentRun[] {
    const where = includeAll ? "session_id = ?" : "session_id = ? AND status = 'running' AND closed = 0";
    const rows = this.db
      .prepare(
        `SELECT run_key, subagent_id, agent_id, agent_type, session_id, turn_id, permission_mode, model, cwd,
                transcript_path, agent_transcript_path, start_event_id, stop_event_id, start_time, stop_time,
                status, closed, close_event_id, close_time, duration_ms, prompt, last_assistant_message,
                start_args_json,
                start_payload, stop_payload, close_payload
           FROM subagent_runs
          WHERE ${where}
          ORDER BY closed ASC, CASE status WHEN 'running' THEN 0 ELSE 1 END, start_time DESC`
      )
      .all(sessionId) as unknown as RunRow[];

    return rows.map(mapRun);
  }

  summary(sessionId: string): SessionSummary {
    const row = this.db
      .prepare(
        `SELECT ? AS session_id,
                COALESCE(SUM(CASE WHEN status = 'running' AND closed = 0 THEN 1 ELSE 0 END), 0) AS running,
                COALESCE(SUM(CASE WHEN status = 'stopped' AND closed = 0 THEN 1 ELSE 0 END), 0) AS stopped,
                COALESCE(SUM(CASE WHEN closed = 1 THEN 1 ELSE 0 END), 0) AS closed,
                COUNT(*) AS total
           FROM subagent_runs
          WHERE session_id = ?`
      )
      .get(sessionId, sessionId) as unknown as SummaryRow;

    return {
      sessionId: row.session_id,
      running: Number(row.running),
      stopped: Number(row.stopped),
      closed: Number(row.closed),
      total: Number(row.total)
    };
  }

  eventsForSession(sessionId: string): EventRow[] {
    return this.db
      .prepare(
        `SELECT id, event_name, session_id, turn_id, subagent_id, agent_id, agent_type, permission_mode,
                model, cwd, transcript_path, agent_transcript_path, prompt, last_assistant_message,
                start_args_json,
                stop_hook_active, tool_name, tool_use_id, close_target, payload_json, created_at
           FROM subagent_events
          WHERE session_id = ?
          ORDER BY id ASC`
      )
      .all(sessionId) as unknown as EventRow[];
  }

  private resolveRunKey(
    eventName: SupportedEvent,
    sessionId: string,
    fields: ExtractedFields,
    payloadJson: string,
    toolStateChange: ToolStateChange | null
  ): string {
    if (toolStateChange) {
      return `${sessionId}:${toolStateChange.target}`;
    }

    if (fields.agentId) {
      return `${sessionId}:${fields.agentId}`;
    }

    if (eventName === "SubagentStop") {
      const row = this.db
        .prepare(
          `SELECT run_key
             FROM subagent_runs
            WHERE session_id = ?
              AND status = 'running'
              AND (? IS NULL OR transcript_path = ?)
            ORDER BY start_time DESC
            LIMIT 1`
        )
        .get(sessionId, fields.transcriptPath, fields.transcriptPath) as { run_key: string } | undefined;
      if (row) {
        return row.run_key;
      }
    }

    const digest = createHash("sha256")
      .update(sessionId)
      .update("\0")
      .update(fields.turnId ?? "")
      .update("\0")
      .update(fields.transcriptPath ?? "")
      .update("\0")
      .update(payloadJson)
      .digest("hex")
      .slice(0, 16);
    return `${sessionId}:unknown:${digest}`;
  }

  private insertEvent(values: {
    eventName: string;
    sessionId: string;
    runKey: string;
    subagentId: string;
    fields: ExtractedFields;
    closeTarget: string | null;
    payloadJson: string;
    createdAt: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO subagent_events
          (event_name, session_id, turn_id, run_key, subagent_id, agent_id, agent_type, permission_mode,
           model, cwd, transcript_path, agent_transcript_path, prompt, last_assistant_message,
           start_args_json, stop_hook_active, tool_name, tool_use_id, close_target, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        values.eventName,
        values.sessionId,
        values.fields.turnId,
        values.runKey,
        values.subagentId,
        values.fields.agentId,
        values.fields.agentType,
        values.fields.permissionMode,
        values.fields.model,
        values.fields.cwd,
        values.fields.transcriptPath,
        values.fields.agentTranscriptPath,
        values.fields.prompt,
        values.fields.lastAssistantMessage,
        values.fields.startArgs,
        values.fields.stopHookActive === null ? null : Number(values.fields.stopHookActive),
        values.fields.toolName,
        values.fields.toolUseId,
        values.closeTarget,
        values.payloadJson,
        values.createdAt
      );

    return Number(result.lastInsertRowid);
  }

  private upsertStart(values: {
    runKey: string;
    sessionId: string;
    subagentId: string;
    fields: ExtractedFields;
    startEventId: number;
    startTime: string;
    startPayload: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO subagent_runs
          (run_key, subagent_id, agent_id, agent_type, session_id, turn_id, permission_mode, model, cwd,
           transcript_path, agent_transcript_path, start_event_id, start_time, status, prompt,
           last_assistant_message, start_args_json, start_payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
         ON CONFLICT(run_key) DO UPDATE SET
           subagent_id = excluded.subagent_id,
           agent_id = excluded.agent_id,
           agent_type = excluded.agent_type,
           session_id = excluded.session_id,
           turn_id = excluded.turn_id,
           permission_mode = excluded.permission_mode,
           model = excluded.model,
           cwd = excluded.cwd,
           transcript_path = excluded.transcript_path,
           agent_transcript_path = excluded.agent_transcript_path,
           start_event_id = excluded.start_event_id,
           stop_event_id = NULL,
           start_time = excluded.start_time,
           stop_time = NULL,
           status = 'running',
           closed = 0,
           close_event_id = NULL,
           close_time = NULL,
           duration_ms = NULL,
           prompt = excluded.prompt,
           last_assistant_message = excluded.last_assistant_message,
           start_args_json = excluded.start_args_json,
           start_payload = excluded.start_payload,
           stop_payload = NULL,
           close_payload = NULL,
           updated_at = excluded.updated_at`
      )
      .run(
        values.runKey,
        values.subagentId,
        values.fields.agentId,
        values.fields.agentType,
        values.sessionId,
        values.fields.turnId,
        values.fields.permissionMode,
        values.fields.model,
        values.fields.cwd,
        values.fields.transcriptPath,
        values.fields.agentTranscriptPath,
        values.startEventId,
        values.startTime,
        values.fields.prompt,
        values.fields.lastAssistantMessage,
        values.fields.startArgs,
        values.startPayload,
        values.startTime
      );
  }

  private applyStop(values: {
    runKey: string;
    sessionId: string;
    subagentId: string;
    fields: ExtractedFields;
    stopEventId: number;
    stopTime: string;
    stopPayload: string;
  }): void {
    const existing = this.db
      .prepare("SELECT start_time FROM subagent_runs WHERE run_key = ?")
      .get(values.runKey) as { start_time: string } | undefined;
    const startTime = existing?.start_time ?? values.stopTime;
    const durationMs = Math.max(0, new Date(values.stopTime).getTime() - new Date(startTime).getTime());

    this.db
      .prepare(
        `INSERT INTO subagent_runs
          (run_key, subagent_id, agent_id, agent_type, session_id, turn_id, permission_mode, model, cwd,
           transcript_path, agent_transcript_path, start_event_id, stop_event_id, start_time, stop_time,
           status, duration_ms, prompt, last_assistant_message, start_args_json, start_payload, stop_payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, NULL, ?, NULL, ?, ?, ?)
         ON CONFLICT(run_key) DO UPDATE SET
           stop_event_id = excluded.stop_event_id,
           stop_time = excluded.stop_time,
           status = 'stopped',
           duration_ms = excluded.duration_ms,
           last_assistant_message = excluded.last_assistant_message,
           stop_payload = excluded.stop_payload,
           updated_at = excluded.updated_at`
      )
      .run(
        values.runKey,
        values.subagentId,
        values.fields.agentId,
        values.fields.agentType,
        values.sessionId,
        values.fields.turnId,
        values.fields.permissionMode,
        values.fields.model,
        values.fields.cwd,
        values.fields.transcriptPath,
        values.fields.agentTranscriptPath,
        values.stopEventId,
        values.stopEventId,
        startTime,
        values.stopTime,
        durationMs,
        values.fields.lastAssistantMessage,
        values.stopPayload,
        values.stopPayload,
        values.stopTime
      );
  }

  private applyClose(values: {
    runKey: string;
    closeEventId: number;
    closeTime: string;
    closePayload: string;
  }): void {
    const result = this.db
      .prepare(
        `UPDATE subagent_runs
            SET closed = 1,
                close_event_id = ?,
                close_time = ?,
                close_payload = ?,
                updated_at = ?
          WHERE run_key = ?`
      )
      .run(values.closeEventId, values.closeTime, values.closePayload, values.closeTime, values.runKey);

    if (result.changes > 0) {
      return;
    }

    const [sessionId, subagentId] = splitRunKey(values.runKey);
    this.db
      .prepare(
        `INSERT INTO subagent_runs
          (run_key, subagent_id, agent_id, session_id, start_event_id, start_time, status,
           closed, close_event_id, close_time, start_payload, close_payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'stopped', 1, ?, ?, ?, ?, ?)`
      )
      .run(
        values.runKey,
        subagentId,
        subagentId,
        sessionId,
        values.closeEventId,
        values.closeTime,
        values.closeEventId,
        values.closeTime,
        values.closePayload,
        values.closePayload,
        values.closeTime
      );
  }

  private resetClosedByRunKey(runKey: string): void {
    this.db
      .prepare(
        `UPDATE subagent_runs
            SET closed = 0,
                close_event_id = NULL,
                close_time = NULL,
                close_payload = NULL,
                updated_at = ?
          WHERE run_key = ?`
      )
      .run(new Date().toISOString(), runKey);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        run_key TEXT NOT NULL,
        subagent_id TEXT NOT NULL,
        agent_id TEXT,
        agent_type TEXT,
        permission_mode TEXT,
        model TEXT,
        cwd TEXT,
        transcript_path TEXT,
        agent_transcript_path TEXT,
        prompt TEXT,
        last_assistant_message TEXT,
        start_args_json TEXT,
        stop_hook_active INTEGER,
        tool_name TEXT,
        tool_use_id TEXT,
        close_target TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subagent_runs (
        run_key TEXT PRIMARY KEY,
        subagent_id TEXT NOT NULL,
        agent_id TEXT,
        agent_type TEXT,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        permission_mode TEXT,
        model TEXT,
        cwd TEXT,
        transcript_path TEXT,
        agent_transcript_path TEXT,
        start_event_id INTEGER NOT NULL,
        stop_event_id INTEGER,
        start_time TEXT NOT NULL,
        stop_time TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'stopped')),
        closed INTEGER NOT NULL DEFAULT 0,
        close_event_id INTEGER,
        close_time TEXT,
        duration_ms INTEGER,
        prompt TEXT,
        last_assistant_message TEXT,
        start_args_json TEXT,
        start_payload TEXT NOT NULL,
        stop_payload TEXT,
        close_payload TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (start_event_id) REFERENCES subagent_events(id),
        FOREIGN KEY (stop_event_id) REFERENCES subagent_events(id),
        FOREIGN KEY (close_event_id) REFERENCES subagent_events(id)
      );

      CREATE INDEX IF NOT EXISTS idx_subagent_events_session_created
        ON subagent_events(session_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_subagent_events_run_key
        ON subagent_events(run_key);

      CREATE INDEX IF NOT EXISTS idx_subagent_runs_session_status_start
        ON subagent_runs(session_id, status, start_time);

    `);
    this.addColumnIfMissing("subagent_events", "tool_name", "tool_name TEXT");
    this.addColumnIfMissing("subagent_events", "tool_use_id", "tool_use_id TEXT");
    this.addColumnIfMissing("subagent_events", "close_target", "close_target TEXT");
    this.addColumnIfMissing("subagent_events", "start_args_json", "start_args_json TEXT");
    this.addColumnIfMissing("subagent_runs", "closed", "closed INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("subagent_runs", "close_event_id", "close_event_id INTEGER");
    this.addColumnIfMissing("subagent_runs", "close_time", "close_time TEXT");
    this.addColumnIfMissing("subagent_runs", "close_payload", "close_payload TEXT");
    this.addColumnIfMissing("subagent_runs", "start_args_json", "start_args_json TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_subagent_runs_session_closed
        ON subagent_runs(session_id, closed, close_time);
    `);
  }

  private addColumnIfMissing(tableName: string, columnName: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === columnName)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

interface ExtractedFields {
  agentId: string | null;
  agentType: string | null;
  turnId: string | null;
  permissionMode: string | null;
  model: string | null;
  cwd: string | null;
  transcriptPath: string | null;
  agentTranscriptPath: string | null;
  prompt: string | null;
  lastAssistantMessage: string | null;
  startArgs: string | null;
  stopHookActive: boolean | null;
  toolName: string | null;
  toolUseId: string | null;
}

function extractFields(payload: HookInput, projectRoot: string, eventName?: SupportedEvent): ExtractedFields {
  return {
    agentId: firstString(payload, ["agent_id", "subagent_id", "agentId", "subagentId", "run_id", "runId"]),
    agentType: firstString(payload, ["agent_type", "agentType"]),
    turnId: firstString(payload, ["turn_id", "turnId"]),
    permissionMode: firstString(payload, ["permission_mode", "permissionMode"]),
    model: stringOrNull(payload.model),
    cwd: stringOrNull(payload.cwd) ?? projectRoot,
    transcriptPath: firstString(payload, ["transcript_path", "transcriptPath"]),
    agentTranscriptPath: firstString(payload, ["agent_transcript_path", "agentTranscriptPath"]),
    prompt: stringOrNull(payload.prompt),
    lastAssistantMessage: firstString(payload, ["last_assistant_message", "lastAssistantMessage"]),
    startArgs: eventName === "SubagentStart" ? compactJson(startArgsFromPayload(payload)) : null,
    stopHookActive: typeof payload.stop_hook_active === "boolean" ? payload.stop_hook_active : null,
    toolName: firstString(payload, ["tool_name", "toolName", "name", "tool"]),
    toolUseId: firstString(payload, ["tool_use_id", "toolUseId", "call_id", "callId"])
  };
}

function startArgsFromPayload(payload: HookInput): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const excluded = new Set(["hook_event_name", "session_id", "turn_id", "transcript_path", "agent_transcript_path"]);
  for (const [key, value] of Object.entries(payload)) {
    if (!excluded.has(key) && value !== undefined) {
      args[key] = value;
    }
  }

  return args;
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

type ToolStateChange = {
  kind: "close" | "resume";
  target: string;
};

function toolStateChangeFromPayload(eventName: SupportedEvent, payload: HookInput): ToolStateChange | null {
  if (eventName !== "PostToolUse") {
    return null;
  }

  const toolName = firstString(payload, ["tool_name", "toolName", "name", "tool"]);
  if (!toolName) {
    return null;
  }

  if (isCloseAgentTool(toolName)) {
    const target = stringField(payload.tool_input, "target") ?? stringField(payload, "target");
    if (!target || !isSuccessfulToolResponse(payload.tool_response, "previous_status")) {
      return null;
    }
    if (agentStatusName(payload.tool_response, "previous_status") === "not_found") {
      return null;
    }

    return {
      kind: "close",
      target
    };
  }

  if (isResumeAgentTool(toolName)) {
    const target = stringField(payload.tool_input, "id") ?? stringField(payload, "id");
    if (!target || !isSuccessfulToolResponse(payload.tool_response, "status")) {
      return null;
    }
    if (agentStatusName(payload.tool_response, "status") === "not_found") {
      return null;
    }

    return {
      kind: "resume",
      target
    };
  }

  return null;
}

function isCloseAgentTool(toolName: string): boolean {
  return toolName === "close_agent" || /^multi_agent_v1(?:[^0-9].*)?close_agent$/.test(toolName);
}

function isResumeAgentTool(toolName: string): boolean {
  return toolName === "resume_agent" || /^multi_agent_v1(?:[^0-9].*)?resume_agent$/.test(toolName);
}

function isSuccessfulToolResponse(value: unknown, requiredStatusField: string): boolean {
  const response = normalizeToolResponse(value);
  if (!isRecord(response)) {
    return false;
  }

  if (response.isError === true || response.is_error === true) {
    return false;
  }

  const structured = recordField(response, "structuredContent") ?? recordField(response, "structured_content");
  if (isRecord(structured) && requiredStatusField in structured) {
    return true;
  }

  return requiredStatusField in response;
}

function agentStatusName(value: unknown, field: string): string | null {
  const response = normalizeToolResponse(value);
  const direct = statusName(recordField(response, field));
  if (direct) {
    return direct;
  }

  const structured = recordField(response, "structuredContent") ?? recordField(response, "structured_content");
  return statusName(recordField(structured, field));
}

function normalizeToolResponse(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function statusName(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length === 1 ? keys[0] : null;
  }

  return null;
}

function stringField(value: unknown, key: string): string | null {
  const field = recordField(value, key);
  return typeof field === "string" && field.length > 0 ? field : null;
}

function recordField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitRunKey(runKey: string): [sessionId: string, subagentId: string] {
  const separator = runKey.indexOf(":");
  if (separator === -1) {
    return ["", runKey];
  }

  return [runKey.slice(0, separator), runKey.slice(separator + 1)];
}

function mapRun(row: RunRow): SubagentRun {
  return {
    runKey: row.run_key,
    subagentId: row.subagent_id,
    agentId: row.agent_id,
    agentType: row.agent_type,
    sessionId: row.session_id,
    turnId: row.turn_id,
    permissionMode: row.permission_mode,
    model: row.model,
    cwd: row.cwd,
    transcriptPath: row.transcript_path,
    agentTranscriptPath: row.agent_transcript_path,
    startEventId: Number(row.start_event_id),
    stopEventId: row.stop_event_id === null ? null : Number(row.stop_event_id),
    startTime: row.start_time,
    stopTime: row.stop_time,
    status: row.status,
    closed: Boolean(row.closed),
    closeEventId: row.close_event_id === null ? null : Number(row.close_event_id),
    closeTime: row.close_time,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    prompt: row.prompt,
    lastAssistantMessage: row.last_assistant_message,
    startArgs: row.start_args_json,
    startPayload: row.start_payload,
    stopPayload: row.stop_payload,
    closePayload: row.close_payload
  };
}
