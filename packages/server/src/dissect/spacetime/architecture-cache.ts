import { CodebaseDissectionSchema, type CodebaseDissection } from "@getpaseo/protocol/dissect";
import type { DissectSpacetimeClient } from "./client.js";

export interface CachedCodebaseArchitecture {
  projectId: string;
  snapshotId: string;
  run: CodebaseDissection;
}

function sqlString(value: string): string {
  return value.replaceAll("'", "''");
}

export function enqueueCodebaseArchitectureCache(
  client: DissectSpacetimeClient | null,
  input: { projectId: string; snapshotId: string; run: CodebaseDissection },
): void {
  if (!client?.enabled) return;
  client.enqueue({
    reducer: "cache_codebase_architecture",
    args: {
      project_id: input.projectId,
      snapshot_id: input.snapshotId,
      run_id: input.run.runId,
      generated_at: input.run.generatedAt,
      payload_json: JSON.stringify(input.run),
    },
  });
}

export async function loadCachedCodebaseArchitecture(
  client: DissectSpacetimeClient | null,
  projectId: string,
): Promise<CachedCodebaseArchitecture | null> {
  if (!client?.enabled || projectId.length === 0) return null;
  const rows = await client.querySql(
    `SELECT project_id, snapshot_id, payload_json FROM codebase_architecture WHERE project_id = '${sqlString(projectId)}'`,
  );
  const row = rows[0];
  if (!row) return null;
  const payloadJson = row.payload_json;
  if (typeof payloadJson !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const run = CodebaseDissectionSchema.safeParse(parsed);
  if (!run.success) return null;
  const snapshotId =
    typeof row.snapshot_id === "string" && row.snapshot_id.length > 0
      ? row.snapshot_id
      : run.data.snapshotId;
  return { projectId, snapshotId, run: run.data };
}
