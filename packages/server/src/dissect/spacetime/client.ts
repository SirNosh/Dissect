import type pino from "pino";
import { overlayDissectLlmEnvFromCheckout } from "../providers/llm-env.js";

/**
 * HTTP adapter for the local Dissect SpacetimeDB module.
 *
 * Writes go through reducers (`POST /v1/database/{name}/call/{reducer}`).
 * Reads use SQL (`POST /v1/database/{name}/sql`). An unreachable server never
 * blocks analysis: writes queue and reads return empty.
 *
 * Defaults to the local standalone install:
 *   DISSECT_SPACETIMEDB_URL=http://127.0.0.1:3000
 *   DISSECT_SPACETIMEDB_DB=dissect
 * Set DISSECT_SPACETIMEDB_DISABLED=1 to turn this off.
 */

export interface SpacetimeReducerCall {
  reducer: string;
  args: Record<string, unknown>;
}

export interface SpacetimeConfig {
  url: string;
  database: string;
  token: string | null;
}

export interface DissectSpacetimeClient {
  readonly enabled: boolean;
  get pendingWrites(): SpacetimeReducerCall[];
  enqueue(call: SpacetimeReducerCall): void;
  flush(): Promise<void>;
  querySql(sql: string): Promise<Record<string, unknown>[]>;
}

const DEFAULT_URL = "http://127.0.0.1:3000";
const DEFAULT_DATABASE = "dissect";
const REQUEST_TIMEOUT_MS = 2_500;

export function resolveSpacetimeConfig(
  env: Record<string, string | undefined>,
): SpacetimeConfig | null {
  if (env.DISSECT_SPACETIMEDB_DISABLED === "1") return null;
  const url = (env.DISSECT_SPACETIMEDB_URL?.trim() || DEFAULT_URL).replace(/\/+$/, "");
  const database = env.DISSECT_SPACETIMEDB_DB?.trim() || DEFAULT_DATABASE;
  if (!url || !database) return null;
  const token = env.DISSECT_SPACETIMEDB_TOKEN?.trim() || null;
  return { url, database, token };
}

export function resolveSpacetimeConfigFromProcess(
  env: Record<string, string | undefined> = process.env,
): SpacetimeConfig | null {
  return resolveSpacetimeConfig(overlayDissectLlmEnvFromCheckout(env));
}

function headers(config: SpacetimeConfig, contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
  };
}

function databaseUrl(config: SpacetimeConfig, suffix: string): string {
  return `${config.url}/v1/database/${encodeURIComponent(config.database)}/${suffix}`;
}

export class HttpSpacetimeClient implements DissectSpacetimeClient {
  private pending: SpacetimeReducerCall[] = [];
  private drainChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: SpacetimeConfig | null,
    private readonly logger: pino.Logger,
    initialPending: SpacetimeReducerCall[] = [],
  ) {
    this.pending = [...initialPending];
  }

  get enabled(): boolean {
    return this.config !== null;
  }

  get pendingWrites(): SpacetimeReducerCall[] {
    return [...this.pending];
  }

  enqueue(call: SpacetimeReducerCall): void {
    if (!this.config) return;
    this.pending.push(call);
    void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.config) return;
    this.drainChain = this.drainChain.then(
      () => this.drainPending(),
      () => this.drainPending(),
    );
    await this.drainChain;
  }

  private async drainPending(): Promise<void> {
    while (this.pending.length > 0) {
      const call = this.pending[0];
      const ok = await this.callReducer(call);
      if (!ok) break;
      this.pending.shift();
    }
  }

  async querySql(sql: string): Promise<Record<string, unknown>[]> {
    if (!this.config) return [];
    try {
      const response = await fetch(databaseUrl(this.config, "sql"), {
        method: "POST",
        headers: headers(this.config, "text/plain"),
        body: sql,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status, sql }, "SpacetimeDB SQL query failed");
        return [];
      }
      const payload: unknown = await response.json();
      return parseSqlRows(payload);
    } catch (error) {
      this.logger.warn({ err: error, sql }, "SpacetimeDB SQL query unreachable");
      return [];
    }
  }

  private async callReducer(call: SpacetimeReducerCall): Promise<boolean> {
    if (!this.config) return false;
    try {
      const response = await fetch(
        databaseUrl(this.config, `call/${encodeURIComponent(call.reducer)}`),
        {
          method: "POST",
          headers: headers(this.config, "application/json"),
          body: JSON.stringify(call.args),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        this.logger.warn(
          { reducer: call.reducer, status: response.status, body: body.slice(0, 500) },
          "SpacetimeDB reducer call failed; keeping write queued",
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        { reducer: call.reducer, err: error },
        "SpacetimeDB unreachable; keeping write queued",
      );
      return false;
    }
  }
}

export function parseSqlRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return [];
    const first = payload[0];
    if (first && typeof first === "object" && "rows" in first) {
      return normalizeStatement(first);
    }
    return normalizeRows(payload, []);
  }
  if (payload && typeof payload === "object" && "rows" in payload) {
    return normalizeStatement(payload);
  }
  return [];
}

function normalizeStatement(statement: object): Record<string, unknown>[] {
  const rows = (statement as { rows?: unknown }).rows;
  const columns = columnNamesFromSchema((statement as { schema?: unknown }).schema);
  return normalizeRows(rows, columns);
}

function columnNamesFromSchema(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const record = schema as {
    elements?: unknown;
    columns?: unknown;
    value?: { elements?: unknown };
  };
  let elements: unknown[] = [];
  if (Array.isArray(record.elements)) {
    elements = record.elements;
  } else if (Array.isArray(record.columns)) {
    elements = record.columns;
  } else if (Array.isArray(record.value?.elements)) {
    elements = record.value.elements;
  }
  return elements.flatMap((element) => {
    if (!element || typeof element !== "object") return [];
    const name = readSqlName(
      (element as { name?: unknown; col?: unknown }).name ?? (element as { col?: unknown }).col,
    );
    return name ? [name] : [];
  });
}

function readSqlName(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (!value || typeof value !== "object") return null;
  const record = value as { some?: unknown; value?: unknown; tag?: unknown };
  if (typeof record.some === "string" && record.some.length > 0) return record.some;
  if (typeof record.value === "string" && record.value.length > 0) return record.value;
  return null;
}

function normalizeRows(rows: unknown, columns: string[]): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      return [row as Record<string, unknown>];
    }
    if (!Array.isArray(row) || columns.length === 0) return [];
    const record: Record<string, unknown> = {};
    for (let index = 0; index < columns.length && index < row.length; index += 1) {
      record[columns[index]] = row[index];
    }
    return [record];
  });
}

type MemoryTables = Record<string, Map<string, Record<string, unknown>>>;

function rowKey(table: string, args: Record<string, unknown>): string {
  switch (table) {
    case "user_profile":
      return String(args.user_id ?? "");
    case "concept_knowledge":
      return `${args.user_id}:${args.concept_key}`;
    case "project_knowledge":
      return `${args.user_id}:${args.project_id}:${args.component_path}`;
    case "explanation_preference":
      return `${args.user_id}:${args.preference_key}`;
    case "feedback_event":
      return `${args.user_id}:${args.created_at}:${args.action}:${args.concept_key}:${args.component_path}`;
    case "project_identity":
      return `${args.user_id}:${args.project_id}`;
    case "codebase_architecture":
      return String(args.project_id ?? "");
    default:
      return JSON.stringify(args);
  }
}

const REDUCER_TABLES: Record<string, string> = {
  ensure_user_profile: "user_profile",
  set_concept_knowledge: "concept_knowledge",
  set_project_knowledge: "project_knowledge",
  set_explanation_preference: "explanation_preference",
  record_feedback_event: "feedback_event",
  map_project_identity: "project_identity",
  cache_codebase_architecture: "codebase_architecture",
};

function applyMemoryReducer(tables: MemoryTables, call: SpacetimeReducerCall): void {
  const table = REDUCER_TABLES[call.reducer];
  if (!table) return;
  const key = rowKey(table, call.args);
  if (!key) return;
  if (table === "codebase_architecture" && tables[table].has(key)) return;
  tables[table].set(key, { id: key, ...call.args });
}

function sqlEquals(sql: string, column: string): string | null {
  const matched = new RegExp(`${column} = '([^']*)'`).exec(sql);
  return matched ? matched[1] : null;
}

export class MemorySpacetimeClient implements DissectSpacetimeClient {
  readonly enabled = true;
  private pending: SpacetimeReducerCall[] = [];
  readonly tables: MemoryTables = {
    user_profile: new Map(),
    concept_knowledge: new Map(),
    project_knowledge: new Map(),
    explanation_preference: new Map(),
    feedback_event: new Map(),
    project_identity: new Map(),
    codebase_architecture: new Map(),
  };

  get architectures(): Map<string, Record<string, unknown>> {
    return this.tables.codebase_architecture;
  }

  get pendingWrites(): SpacetimeReducerCall[] {
    return [...this.pending];
  }

  enqueue(call: SpacetimeReducerCall): void {
    this.pending.push(call);
    applyMemoryReducer(this.tables, call);
  }

  async flush(): Promise<void> {
    this.pending = [];
  }

  async querySql(sql: string): Promise<Record<string, unknown>[]> {
    const tableMatch = /FROM\s+(\w+)/i.exec(sql);
    if (!tableMatch) return [];
    const rows = [...(this.tables[tableMatch[1]]?.values() ?? [])];
    const userId = sqlEquals(sql, "user_id");
    const projectId = sqlEquals(sql, "project_id");
    return rows.filter((row) => {
      if (userId !== null && String(row.user_id ?? "") !== userId) return false;
      if (projectId !== null && String(row.project_id ?? "") !== projectId) return false;
      return true;
    });
  }
}
