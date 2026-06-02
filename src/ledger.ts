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
  stop_hook_active: number | null;
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
  duration_ms: number | null;
  prompt: string | null;
  last_assistant_message: string | null;
  start_payload: string;
  stop_payload: string | null;
}

interface SummaryRow {
  session_id: string;
  running: number;
  stopped: number;
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
    const fields = extractFields(input.payload, input.projectRoot);
    const runKey = this.resolveRunKey(input.eventName, input.sessionId, fields, payloadJson);
    const subagentId = fields.agentId ?? runKey;

    const eventId = this.insertEvent({
      eventName: input.eventName,
      sessionId: input.sessionId,
      runKey,
      subagentId,
      fields,
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
    } else {
      this.applyStop({
        runKey,
        sessionId: input.sessionId,
        subagentId,
        fields,
        stopEventId: eventId,
        stopTime: now,
        stopPayload: payloadJson
      });
    }

    return { eventId, subagentId };
  }

  listSession(sessionId: string, includeAll = true): SubagentRun[] {
    const where = includeAll ? "session_id = ?" : "session_id = ? AND status = 'running'";
    const rows = this.db
      .prepare(
        `SELECT run_key, subagent_id, agent_id, agent_type, session_id, turn_id, permission_mode, model, cwd,
                transcript_path, agent_transcript_path, start_event_id, stop_event_id, start_time, stop_time,
                status, duration_ms, prompt, last_assistant_message, start_payload, stop_payload
           FROM subagent_runs
          WHERE ${where}
          ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, start_time DESC`
      )
      .all(sessionId) as unknown as RunRow[];

    return rows.map(mapRun);
  }

  summary(sessionId: string): SessionSummary {
    const row = this.db
      .prepare(
        `SELECT ? AS session_id,
                COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running,
                COALESCE(SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END), 0) AS stopped,
                COUNT(*) AS total
           FROM subagent_runs
          WHERE session_id = ?`
      )
      .get(sessionId, sessionId) as unknown as SummaryRow;

    return {
      sessionId: row.session_id,
      running: Number(row.running),
      stopped: Number(row.stopped),
      total: Number(row.total)
    };
  }

  eventsForSession(sessionId: string): EventRow[] {
    return this.db
      .prepare(
        `SELECT id, event_name, session_id, turn_id, subagent_id, agent_id, agent_type, permission_mode,
                model, cwd, transcript_path, agent_transcript_path, prompt, last_assistant_message,
                stop_hook_active, payload_json, created_at
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
    payloadJson: string
  ): string {
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
    payloadJson: string;
    createdAt: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO subagent_events
          (event_name, session_id, turn_id, run_key, subagent_id, agent_id, agent_type, permission_mode,
           model, cwd, transcript_path, agent_transcript_path, prompt, last_assistant_message,
           stop_hook_active, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        values.fields.stopHookActive === null ? null : Number(values.fields.stopHookActive),
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
           last_assistant_message, start_payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
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
           duration_ms = NULL,
           prompt = excluded.prompt,
           last_assistant_message = excluded.last_assistant_message,
           start_payload = excluded.start_payload,
           stop_payload = NULL,
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
           status, duration_ms, prompt, last_assistant_message, start_payload, stop_payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, NULL, ?, ?, ?, ?)
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
        stop_hook_active INTEGER,
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
        duration_ms INTEGER,
        prompt TEXT,
        last_assistant_message TEXT,
        start_payload TEXT NOT NULL,
        stop_payload TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (start_event_id) REFERENCES subagent_events(id),
        FOREIGN KEY (stop_event_id) REFERENCES subagent_events(id)
      );

      CREATE INDEX IF NOT EXISTS idx_subagent_events_session_created
        ON subagent_events(session_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_subagent_events_run_key
        ON subagent_events(run_key);

      CREATE INDEX IF NOT EXISTS idx_subagent_runs_session_status_start
        ON subagent_runs(session_id, status, start_time);
    `);
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
  stopHookActive: boolean | null;
}

function extractFields(payload: HookInput, projectRoot: string): ExtractedFields {
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
    stopHookActive: typeof payload.stop_hook_active === "boolean" ? payload.stop_hook_active : null
  };
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
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    prompt: row.prompt,
    lastAssistantMessage: row.last_assistant_message,
    startPayload: row.start_payload,
    stopPayload: row.stop_payload
  };
}
