import { DissectFamiliaritySchema, type DissectFamiliarity } from "@getpaseo/protocol/dissect";
import type { DissectSpacetimeClient } from "../spacetime/client.js";

export const DISSECT_SPACETIME_REDUCERS = {
  ensureUserProfile: "ensure_user_profile",
  setConceptKnowledge: "set_concept_knowledge",
  setProjectKnowledge: "set_project_knowledge",
  setExplanationPreference: "set_explanation_preference",
  recordFeedbackEvent: "record_feedback_event",
  mapProjectIdentity: "map_project_identity",
  cacheCodebaseArchitecture: "cache_codebase_architecture",
} as const;

export function familiarityForAction(action: "know" | "explain_more"): DissectFamiliarity {
  return action === "know" ? "comfortable" : "learning";
}

function sqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function readFamiliarity(value: unknown): DissectFamiliarity | null {
  const parsed = DissectFamiliaritySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface HydratedSpacetimeKnowledge {
  concepts: Record<string, DissectFamiliarity>;
  components: Record<string, DissectFamiliarity>;
  preferences: Record<string, string>;
}

export async function loadKnowledgeFromSpacetime(
  client: DissectSpacetimeClient | null,
  input: { userId: string; projectId: string },
): Promise<HydratedSpacetimeKnowledge | null> {
  if (!client?.enabled || input.userId.length === 0) return null;
  const userId = sqlString(input.userId);
  const projectId = sqlString(input.projectId);
  const [conceptRows, projectRows, preferenceRows] = await Promise.all([
    client.querySql(
      `SELECT concept_key, familiarity FROM concept_knowledge WHERE user_id = '${userId}'`,
    ),
    input.projectId.length > 0
      ? client.querySql(
          `SELECT component_path, familiarity FROM project_knowledge WHERE user_id = '${userId}' AND project_id = '${projectId}'`,
        )
      : Promise.resolve([]),
    client.querySql(
      `SELECT preference_key, value FROM explanation_preference WHERE user_id = '${userId}'`,
    ),
  ]);
  if (conceptRows.length === 0 && projectRows.length === 0 && preferenceRows.length === 0) {
    return null;
  }
  const concepts: Record<string, DissectFamiliarity> = {};
  for (const row of conceptRows) {
    if (typeof row.concept_key !== "string") continue;
    const familiarity = readFamiliarity(row.familiarity);
    if (familiarity) concepts[row.concept_key] = familiarity;
  }
  const components: Record<string, DissectFamiliarity> = {};
  for (const row of projectRows) {
    if (typeof row.component_path !== "string") continue;
    const familiarity = readFamiliarity(row.familiarity);
    if (familiarity) components[row.component_path] = familiarity;
  }
  const preferences: Record<string, string> = {};
  for (const row of preferenceRows) {
    if (typeof row.preference_key !== "string" || typeof row.value !== "string") continue;
    preferences[row.preference_key] = row.value;
  }
  return { concepts, components, preferences };
}

export function enqueueUserProfile(
  client: DissectSpacetimeClient | null,
  input: { userId: string; createdAt: string },
): void {
  if (!client?.enabled) return;
  const now = new Date().toISOString();
  client.enqueue({
    reducer: DISSECT_SPACETIME_REDUCERS.ensureUserProfile,
    args: {
      user_id: input.userId,
      created_at: input.createdAt,
      updated_at: now,
    },
  });
}

export function enqueueProjectIdentity(
  client: DissectSpacetimeClient | null,
  input: { userId: string; projectId: string; cwd: string },
): void {
  if (!client?.enabled || input.projectId.length === 0) return;
  const now = new Date().toISOString();
  client.enqueue({
    reducer: DISSECT_SPACETIME_REDUCERS.mapProjectIdentity,
    args: {
      user_id: input.userId,
      project_id: input.projectId,
      cwd: input.cwd,
      created_at: now,
      updated_at: now,
    },
  });
}

export function enqueueKnowledgeSignal(
  client: DissectSpacetimeClient | null,
  input: {
    userId: string;
    projectId: string;
    kind: "concept" | "component";
    key: string;
    action: "know" | "explain_more";
    familiarity: DissectFamiliarity;
  },
): void {
  if (!client?.enabled) return;
  const now = new Date().toISOString();
  if (input.kind === "concept") {
    client.enqueue({
      reducer: DISSECT_SPACETIME_REDUCERS.setConceptKnowledge,
      args: {
        user_id: input.userId,
        concept_key: input.key,
        familiarity: input.familiarity,
        updated_at: now,
      },
    });
  } else {
    client.enqueue({
      reducer: DISSECT_SPACETIME_REDUCERS.setProjectKnowledge,
      args: {
        user_id: input.userId,
        project_id: input.projectId,
        component_path: input.key,
        familiarity: input.familiarity,
        updated_at: now,
      },
    });
  }
  client.enqueue({
    reducer: DISSECT_SPACETIME_REDUCERS.recordFeedbackEvent,
    args: {
      user_id: input.userId,
      project_id: input.projectId,
      concept_key: input.kind === "concept" ? input.key : "",
      component_path: input.kind === "component" ? input.key : "",
      action: input.action,
      created_at: now,
    },
  });
}

export function enqueueLocalKnowledgeBackfill(
  client: DissectSpacetimeClient | null,
  input: {
    userId: string;
    createdAt: string;
    cwd: string;
    projectId: string;
    concepts: Record<string, DissectFamiliarity>;
    components: Record<string, DissectFamiliarity>;
    preferences: Record<string, string>;
  },
): void {
  if (!client?.enabled) return;
  enqueueUserProfile(client, { userId: input.userId, createdAt: input.createdAt });
  enqueueProjectIdentity(client, {
    userId: input.userId,
    projectId: input.projectId,
    cwd: input.cwd,
  });
  const now = new Date().toISOString();
  for (const [conceptKey, familiarity] of Object.entries(input.concepts)) {
    client.enqueue({
      reducer: DISSECT_SPACETIME_REDUCERS.setConceptKnowledge,
      args: {
        user_id: input.userId,
        concept_key: conceptKey,
        familiarity,
        updated_at: now,
      },
    });
  }
  for (const [componentPath, familiarity] of Object.entries(input.components)) {
    client.enqueue({
      reducer: DISSECT_SPACETIME_REDUCERS.setProjectKnowledge,
      args: {
        user_id: input.userId,
        project_id: input.projectId,
        component_path: componentPath,
        familiarity,
        updated_at: now,
      },
    });
  }
  for (const [preferenceKey, value] of Object.entries(input.preferences)) {
    client.enqueue({
      reducer: DISSECT_SPACETIME_REDUCERS.setExplanationPreference,
      args: {
        user_id: input.userId,
        preference_key: preferenceKey,
        value,
        updated_at: now,
      },
    });
  }
}
