import { schema, table, t } from "spacetimedb/server";

/**
 * Local Dissect module.
 *
 * SpacetimeDB persists explicit developer knowledge, identity mappings, and
 * the first architecture cache. It is not the source of truth for repository
 * contents. Writes go through reducers.
 *
 * Publish to the local standalone server:
 *   spacetime publish -s local -p spacetime/dissect --yes dissect
 */

const userProfile = table(
  { name: "user_profile", public: true },
  {
    user_id: t.string().primaryKey(),
    created_at: t.string(),
    updated_at: t.string(),
  },
);

const conceptKnowledge = table(
  { name: "concept_knowledge", public: true },
  {
    id: t.string().primaryKey(),
    user_id: t.string().index("btree"),
    concept_key: t.string(),
    familiarity: t.string(),
    updated_at: t.string(),
  },
);

const projectKnowledge = table(
  { name: "project_knowledge", public: true },
  {
    id: t.string().primaryKey(),
    user_id: t.string().index("btree"),
    project_id: t.string().index("btree"),
    component_path: t.string(),
    familiarity: t.string(),
    updated_at: t.string(),
  },
);

const explanationPreference = table(
  { name: "explanation_preference", public: true },
  {
    id: t.string().primaryKey(),
    user_id: t.string().index("btree"),
    preference_key: t.string(),
    value: t.string(),
    updated_at: t.string(),
  },
);

const feedbackEvent = table(
  { name: "feedback_event", public: true },
  {
    id: t.string().primaryKey(),
    user_id: t.string().index("btree"),
    project_id: t.string(),
    concept_key: t.string(),
    component_path: t.string(),
    action: t.string(),
    created_at: t.string(),
  },
);

const projectIdentity = table(
  { name: "project_identity", public: true },
  {
    id: t.string().primaryKey(),
    user_id: t.string().index("btree"),
    project_id: t.string(),
    cwd: t.string(),
    created_at: t.string(),
    updated_at: t.string(),
  },
);

const codebaseArchitecture = table(
  { name: "codebase_architecture", public: true },
  {
    project_id: t.string().primaryKey(),
    snapshot_id: t.string(),
    run_id: t.string(),
    generated_at: t.string(),
    payload_json: t.string(),
  },
);

const spacetimedb = schema({
  user_profile: userProfile,
  concept_knowledge: conceptKnowledge,
  project_knowledge: projectKnowledge,
  explanation_preference: explanationPreference,
  feedback_event: feedbackEvent,
  project_identity: projectIdentity,
  codebase_architecture: codebaseArchitecture,
});

export default spacetimedb;

export const ensure_user_profile = spacetimedb.reducer(
  {
    user_id: t.string(),
    created_at: t.string(),
    updated_at: t.string(),
  },
  (ctx, args) => {
    const existing = ctx.db.user_profile.user_id.find(args.user_id);
    if (existing) {
      ctx.db.user_profile.user_id.update({ ...existing, updated_at: args.updated_at });
      return;
    }
    ctx.db.user_profile.insert(args);
  },
);

export const set_concept_knowledge = spacetimedb.reducer(
  {
    user_id: t.string(),
    concept_key: t.string(),
    familiarity: t.string(),
    updated_at: t.string(),
  },
  (ctx, args) => {
    const id = `${args.user_id}:${args.concept_key}`;
    const row = { id, ...args };
    if (ctx.db.concept_knowledge.id.find(id)) {
      ctx.db.concept_knowledge.id.update(row);
      return;
    }
    ctx.db.concept_knowledge.insert(row);
  },
);

export const set_project_knowledge = spacetimedb.reducer(
  {
    user_id: t.string(),
    project_id: t.string(),
    component_path: t.string(),
    familiarity: t.string(),
    updated_at: t.string(),
  },
  (ctx, args) => {
    const id = `${args.user_id}:${args.project_id}:${args.component_path}`;
    const row = { id, ...args };
    if (ctx.db.project_knowledge.id.find(id)) {
      ctx.db.project_knowledge.id.update(row);
      return;
    }
    ctx.db.project_knowledge.insert(row);
  },
);

export const set_explanation_preference = spacetimedb.reducer(
  {
    user_id: t.string(),
    preference_key: t.string(),
    value: t.string(),
    updated_at: t.string(),
  },
  (ctx, args) => {
    const id = `${args.user_id}:${args.preference_key}`;
    const row = { id, ...args };
    if (ctx.db.explanation_preference.id.find(id)) {
      ctx.db.explanation_preference.id.update(row);
      return;
    }
    ctx.db.explanation_preference.insert(row);
  },
);

export const record_feedback_event = spacetimedb.reducer(
  {
    user_id: t.string(),
    project_id: t.string(),
    concept_key: t.string(),
    component_path: t.string(),
    action: t.string(),
    created_at: t.string(),
  },
  (ctx, args) => {
    ctx.db.feedback_event.insert({
      id: `${args.user_id}:${args.created_at}:${args.action}:${args.concept_key}:${args.component_path}`,
      ...args,
    });
  },
);

export const map_project_identity = spacetimedb.reducer(
  {
    user_id: t.string(),
    project_id: t.string(),
    cwd: t.string(),
    created_at: t.string(),
    updated_at: t.string(),
  },
  (ctx, args) => {
    const id = `${args.user_id}:${args.project_id}`;
    const row = { id, ...args };
    if (ctx.db.project_identity.id.find(id)) {
      ctx.db.project_identity.id.update(row);
      return;
    }
    ctx.db.project_identity.insert(row);
  },
);

export const cache_codebase_architecture = spacetimedb.reducer(
  {
    project_id: t.string(),
    snapshot_id: t.string(),
    run_id: t.string(),
    generated_at: t.string(),
    payload_json: t.string(),
  },
  (ctx, args) => {
    const existing = ctx.db.codebase_architecture.project_id.find(args.project_id);
    if (existing) return;
    ctx.db.codebase_architecture.insert(args);
  },
);
