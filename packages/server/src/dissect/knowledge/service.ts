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
  enqueueConceptFamiliarity,
  enqueueKnowledgeSignal,
  enqueueLocalKnowledgeBackfill,
  enqueueProjectIdentity,
  enqueueUserProfile,
  familiarityForAction,
  loadKnowledgeFromSpacetime,
} from "./spacetime-sync.js";
import { normalizePassage, retrieveKnowledge, STORED_PASSAGE_CHARS } from "./retrieve.js";
import type { KnowledgeQuery, KnowledgeRetriever, RetrievedKnowledge } from "./retrieve.js";

const PersistedKnowledgeSchema = z.object({
  userId: z.string(),
  createdAt: z.string().optional(),
  revision: z.number().int().nonnegative(),
  concepts: z.record(z.string(), DissectFamiliaritySchema),
  projects: z.record(z.string(), z.record(z.string(), DissectFamiliaritySchema)),
  preferences: z.record(z.string(), z.string()).optional(),
  // Last explanation shown. Local only; familiarity is what syncs.
  conceptPassages: z.record(z.string(), z.string()).optional(),
  projectPassages: z.record(z.string(), z.record(z.string(), z.string())).optional(),
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
    conceptPassages: {},
    projectPassages: {},
    pendingSpacetimeWrites: [],
  };
}

/**
 * Explicit developer knowledge: global concept familiarity plus per-project
 * component familiarity. SpacetimeDB is the durable store. Local JSON is the
 * fallback and the outage queue so analysis never depends on the database.
 * Passages are the last explanation shown and stay in the local file.
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
    this.state.conceptPassages = this.state.conceptPassages ?? {};
    this.state.projectPassages = this.state.projectPassages ?? {};
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

  async retriever(projectId: string, cwd = ""): Promise<KnowledgeRetriever> {
    const state = await this.load();
    await this.hydrateProject(projectId, cwd);
    const concepts = { ...state.concepts };
    const components = { ...state.projects[projectId] };
    const conceptPassages = { ...state.conceptPassages };
    const componentPassages = { ...state.projectPassages?.[projectId] };
    return {
      retrieve(query: KnowledgeQuery): RetrievedKnowledge {
        return retrieveKnowledge(
          { concepts, components, conceptPassages, componentPassages },
          query,
        );
      },
    };
  }

  /**
   * Record explanations that were just shown. Concepts with no stronger
   * signal become `introduced`. Comfortable and learning stay user-driven.
   * Component familiarity is left unchanged.
   */
  async observe(input: {
    projectId: string;
    cwd?: string;
    concepts: ReadonlyArray<{ key: string; explanation: string }>;
    components: ReadonlyArray<{ path: string; summary: string }>;
  }): Promise<void> {
    const state = await this.load();
    await this.hydrateProject(input.projectId, input.cwd ?? "");
    state.conceptPassages = state.conceptPassages ?? {};
    state.projectPassages = state.projectPassages ?? {};
    const passages = state.projectPassages[input.projectId] ?? {};
    let dirty = false;
    let familiarityChanged = false;

    for (const concept of input.concepts) {
      const key = concept.key.trim();
      const explanation = normalizePassage(concept.explanation, STORED_PASSAGE_CHARS);
      if (key.length === 0 || !explanation) continue;
      const current = state.concepts[key];
      if (current === undefined || current === "unseen") {
        state.concepts[key] = "introduced";
        familiarityChanged = true;
        dirty = true;
        enqueueConceptFamiliarity(this.spacetime, {
          userId: state.userId,
          conceptKey: key,
          familiarity: "introduced",
        });
      }
      if (state.conceptPassages[key] !== explanation) {
        state.conceptPassages[key] = explanation;
        dirty = true;
      }
    }

    for (const component of input.components) {
      const componentPath = component.path.trim().replaceAll("\\", "/");
      const summary = normalizePassage(component.summary, STORED_PASSAGE_CHARS);
      if (componentPath.length === 0 || !summary) continue;
      if (passages[componentPath] === summary) continue;
      passages[componentPath] = summary;
      dirty = true;
    }

    if (!dirty) return;
    if (input.projectId.length > 0) {
      state.projectPassages[input.projectId] = passages;
    }
    if (familiarityChanged) state.revision += 1;
    await this.persist();
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
