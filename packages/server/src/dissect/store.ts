import { promises as fs } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import {
  CodebaseDissectionSchema,
  DiffDissectionSchema,
  FileDissectionSchema,
} from "@getpaseo/protocol/dissect";
import { writeJsonFileAtomic } from "../server/atomic-file.js";
import { projectKeyForCwd } from "./repository/hash.js";
import type { DissectSpacetimeClient } from "./spacetime/client.js";
import {
  enqueueCodebaseArchitectureCache,
  loadCachedCodebaseArchitecture,
} from "./spacetime/architecture-cache.js";

const PersistedProjectStateSchema = z.object({
  cwd: z.string(),
  baselineSnapshotId: z.string().nullable(),
  run: CodebaseDissectionSchema.nullable(),
  lastDiff: DiffDissectionSchema.nullable(),
  agentTurn: z
    .object({
      fromSnapshotId: z.string(),
      toSnapshotId: z.string().nullable(),
    })
    .nullable()
    .optional(),
  fileDissections: z.record(
    z.string(),
    z.object({
      contentHash: z.string(),
      // COMPAT(dissectKnowledgeRevision): caches written before retrieval slices. Remove after 2026-12-23.
      knowledgeRevision: z.number().int().nonnegative().optional(),
      retrievalKey: z.string().optional(),
      result: FileDissectionSchema,
    }),
  ),
});

export type PersistedProjectState = z.infer<typeof PersistedProjectStateSchema>;

function emptyProjectState(cwd: string): PersistedProjectState {
  return {
    cwd,
    baselineSnapshotId: null,
    run: null,
    lastDiff: null,
    agentTurn: null,
    fileDissections: {},
  };
}

/**
 * File-backed store for Dissect results, one JSON document per workspace path
 * under `$PASEO_HOME/dissect/projects/`. Writes are atomic and serialized.
 */
export class DissectProjectStore {
  private readonly directory: string;
  private readonly cache = new Map<string, PersistedProjectState>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    paseoHome: string,
    private readonly logger: pino.Logger,
    private readonly spacetime: DissectSpacetimeClient | null = null,
  ) {
    this.directory = path.join(paseoHome, "dissect", "projects");
  }

  projectId(cwd: string): string {
    return projectKeyForCwd(cwd);
  }

  private fileFor(cwd: string): string {
    return path.join(this.directory, `${projectKeyForCwd(cwd)}.json`);
  }

  async load(cwd: string): Promise<PersistedProjectState> {
    const key = projectKeyForCwd(cwd);
    const cached = this.cache.get(key);
    if (cached) return cached;
    let state: PersistedProjectState;
    try {
      const raw = await fs.readFile(this.fileFor(cwd), "utf8");
      const parsed = PersistedProjectStateSchema.safeParse(JSON.parse(raw));
      state = parsed.success ? parsed.data : emptyProjectState(cwd);
    } catch {
      state = emptyProjectState(cwd);
    }
    if (!state.run) {
      const fromSpacetime = await loadCachedCodebaseArchitecture(this.spacetime, key);
      if (fromSpacetime) {
        state.run = fromSpacetime.run;
        state.baselineSnapshotId = fromSpacetime.snapshotId;
        this.cache.set(key, state);
        await this.persist(cwd, state);
        return state;
      }
    } else {
      enqueueCodebaseArchitectureCache(this.spacetime, {
        projectId: key,
        snapshotId: state.baselineSnapshotId ?? state.run.snapshotId,
        run: state.run,
      });
    }
    this.cache.set(key, state);
    return state;
  }

  async save(cwd: string, mutate: (state: PersistedProjectState) => void): Promise<void> {
    const state = await this.load(cwd);
    mutate(state);
    await this.persist(cwd, state);
  }

  private async persist(cwd: string, state: PersistedProjectState): Promise<void> {
    const filePath = this.fileFor(cwd);
    this.writeQueue = this.writeQueue.then(() =>
      writeJsonFileAtomic(filePath, state).catch((error) => {
        this.logger.warn({ err: error, cwd }, "Failed to persist Dissect project state");
      }),
    );
    await this.writeQueue;
  }
}
