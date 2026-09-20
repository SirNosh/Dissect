import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type pino from "pino";
import { z } from "zod";
import type { DissectKnowledgeState } from "@getpaseo/protocol/dissect";
import { DissectFamiliaritySchema } from "@getpaseo/protocol/dissect";
import { writeJsonFileAtomic } from "../../server/atomic-file.js";
import {
  HttpSpacetimeClient,
  resolveSpacetimeConfigFromProcess,
  type DissectSpacetimeClient,
  type SpacetimeReducerCall,
} from "../spacetime/client.js";
import { loadOrCreateDissectUserIdentity } from "./identity.js";
import {
  enqueueKnowledgeSignal,
  enqueueLocalKnowledgeBackfill,
  enqueueProjectIdentity,
  enqueueUserProfile,
  familiarityForAction,
  loadKnowledgeFromSpacetime,
} from "./spacetime-sync.js";

const PersistedKnowledgeSchema = z.object({
  userId: z.string(),
  createdAt: z.string().optional(),
  revision: z.number().int().nonnegative(),
  concepts: z.record(z.string(), DissectFamiliaritySchema),
  projects: z.record(z.string(), z.record(z.string(), DissectFamiliaritySchema)),
  preferences: z.record(z.string(), z.string()).optional(),
  pendingSpacetimeWrites: z
    .array(z.object({ reducer: z.string(), args: z.record(z.string(), z.unknown()) }))
    .optional(),
});

type PersistedKnowledge = z.infer<typeof PersistedKnowledgeSchema>;

function emptyKnowledge(): PersistedKnowledge {
  return {
    userId: randomUUID(),
    createdAt: new Date().toISOString(),
    revision: 0,
    concepts: {},
    projects: {},
    preferences: {},
    pendingSpacetimeWrites: [],
  };
}

/**
 * Explicit developer knowledge: global concept familiarity plus per-project
 * component familiarity. SpacetimeDB is the durable store. Local JSON is the
 * fallback and the outage queue so analysis never depends on the database.
 */
export class DissectKnowledgeService {
  private readonly filePath: string;
  private readonly paseoHome: string;
  private state: PersistedKnowledge | null = null;
  private spacetime: DissectSpacetimeClient | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private hydratedProjects = new Set<string>();

  constructor(
    paseoHome: string,
    private readonly logger: pino.Logger,
    spacetime?: DissectSpacetimeClient | null,
  ) {
    this.paseoHome = paseoHome;
    this.filePath = path.join(paseoHome, "dissect", "knowledge.json");
    this.spacetime = spacetime ?? null;
  }

  private async load(): Promise<PersistedKnowledge> {
    if (this.state) return this.state;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = PersistedKnowledgeSchema.safeParse(JSON.parse(raw));
      this.state = parsed.success ? parsed.data : emptyKnowledge();
    } catch {
      this.state = emptyKnowledge();
    }
    const identity = await loadOrCreateDissectUserIdentity(this.paseoHome, this.state.userId);
    this.state.userId = identity.userId;
    this.state.createdAt = this.state.createdAt ?? identity.createdAt;
    const pending = this.state.pendingSpacetimeWrites ?? [];
    if (!this.spacetime) {
      this.spacetime = new HttpSpacetimeClient(
        resolveSpacetimeConfigFromProcess(),
        this.logger,
        pending as SpacetimeReducerCall[],
      );
    } else {
      for (const call of pending) {
        this.spacetime.enqueue(call);
      }
    }
    enqueueUserProfile(this.spacetime, {
      userId: this.state.userId,
      createdAt: this.state.createdAt ?? identity.createdAt,
    });
    await this.spacetime.flush();
    await this.persist();
    return this.state;
  }

  private async persist(): Promise<void> {
    const state = this.state;
    if (!state) return;
    state.pendingSpacetimeWrites = this.spacetime?.pendingWrites ?? [];
    this.writeQueue = this.writeQueue.then(() =>
      writeJsonFileAtomic(this.filePath, state).catch((error) => {
        this.logger.warn({ err: error }, "Failed to persist Dissect knowledge state");
      }),
    );
    await this.writeQueue;
  }

  private async hydrateProject(projectId: string, cwd: string): Promise<void> {
    const state = await this.load();
    if (this.hydratedProjects.has(projectId)) {
      enqueueProjectIdentity(this.spacetime, {
        userId: state.userId,
        projectId,
        cwd,
      });
      return;
    }
    this.hydratedProjects.add(projectId);
    const unflushed = this.spacetime?.pendingWrites.length ?? 0;
    if (unflushed === 0) {
      const remote = await loadKnowledgeFromSpacetime(this.spacetime, {
        userId: state.userId,
        projectId,
      });
      if (remote) {
        const previousConcepts = JSON.stringify(state.concepts);
        const previousComponents = JSON.stringify(state.projects[projectId] ?? {});
        state.concepts = { ...remote.concepts };
        if (projectId.length > 0) {
          state.projects[projectId] = { ...remote.components };
        }
        state.preferences = remote.preferences;
        if (
          JSON.stringify(state.concepts) !== previousConcepts ||
          JSON.stringify(state.projects[projectId] ?? {}) !== previousComponents
        ) {
          state.revision += 1;
        }
        await this.persist();
      } else {
        const localComponents = state.projects[projectId] ?? {};
        if (
          Object.keys(state.concepts).length > 0 ||
          Object.keys(localComponents).length > 0 ||
          Object.keys(state.preferences ?? {}).length > 0
        ) {
          enqueueLocalKnowledgeBackfill(this.spacetime, {
            userId: state.userId,
            createdAt: state.createdAt ?? new Date().toISOString(),
            cwd,
            projectId,
            concepts: state.concepts,
            components: localComponents,
            preferences: state.preferences ?? {},
          });
        }
      }
    }
    enqueueProjectIdentity(this.spacetime, {
      userId: state.userId,
      projectId,
      cwd,
    });
  }

  async getState(projectId: string, cwd = ""): Promise<DissectKnowledgeState> {
    const state = await this.load();
    await this.hydrateProject(projectId, cwd);
    return {
      revision: state.revision,
      concepts: { ...state.concepts },
      components: { ...state.projects[projectId] },
    };
  }

  async signal(input: {
    projectId: string;
    cwd?: string;
    kind: "concept" | "component";
    key: string;
    action: "know" | "explain_more";
  }): Promise<DissectKnowledgeState> {
    const state = await this.load();
    await this.hydrateProject(input.projectId, input.cwd ?? "");
    const familiarity = familiarityForAction(input.action);
    const key = input.key.trim();
    if (key.length > 0) {
      if (input.kind === "concept") {
        state.concepts[key] = familiarity;
      } else {
        const components = state.projects[input.projectId] ?? {};
        components[key] = familiarity;
        state.projects[input.projectId] = components;
      }
      state.revision += 1;
      enqueueKnowledgeSignal(this.spacetime, {
        userId: state.userId,
        projectId: input.projectId,
        kind: input.kind,
        key,
        action: input.action,
        familiarity,
      });
      await this.persist();
    }
    return this.getState(input.projectId, input.cwd ?? "");
  }
}
