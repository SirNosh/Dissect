import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { HttpSpacetimeClient, MemorySpacetimeClient } from "../spacetime/client.js";
import { DissectKnowledgeService } from "./service.js";
import { familiarityForAction } from "./spacetime-sync.js";

const logger = createTestLogger();

describe("familiarityForAction", () => {
  it("maps explicit signals to familiarity states", () => {
    expect(familiarityForAction("know")).toBe("comfortable");
    expect(familiarityForAction("explain_more")).toBe("learning");
  });
});

describe("DissectKnowledgeService SpacetimeDB", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists I know this / Explain more into SpacetimeDB and hydrates a later process", async () => {
    const home = mkdtempSync(join(tmpdir(), "dissect-knowledge-"));
    directories.push(home);
    const spacetime = new MemorySpacetimeClient();
    const first = new DissectKnowledgeService(home, logger, spacetime);
    const afterKnow = await first.signal({
      projectId: "proj-a",
      cwd: "/repo",
      kind: "concept",
      key: "jwt",
      action: "know",
    });
    expect(afterKnow.concepts.jwt).toBe("comfortable");
    const afterComponent = await first.signal({
      projectId: "proj-a",
      cwd: "/repo",
      kind: "component",
      key: "/auth",
      action: "explain_more",
    });
    expect(afterComponent.components["/auth"]).toBe("learning");
    expect(spacetime.tables.concept_knowledge.size).toBe(1);
    expect(spacetime.tables.project_knowledge.size).toBe(1);
    expect(spacetime.tables.feedback_event.size).toBe(2);
    expect(spacetime.tables.user_profile.size).toBe(1);
    expect(spacetime.tables.project_identity.size).toBe(1);

    unlinkSync(join(home, "dissect", "knowledge.json"));
    const restored = new DissectKnowledgeService(home, logger, spacetime);
    const state = await restored.getState("proj-a", "/repo");
    expect(state.concepts.jwt).toBe("comfortable");
    expect(state.components["/auth"]).toBe("learning");
  });

  it("keeps a stable installation identity across knowledge writes", async () => {
    const home = mkdtempSync(join(tmpdir(), "dissect-identity-"));
    directories.push(home);
    const spacetime = new MemorySpacetimeClient();
    const service = new DissectKnowledgeService(home, logger, spacetime);
    await service.signal({
      projectId: "proj-a",
      cwd: "/repo",
      kind: "concept",
      key: "rest",
      action: "know",
    });
    await service.signal({
      projectId: "proj-a",
      cwd: "/repo",
      kind: "concept",
      key: "jwt",
      action: "know",
    });
    const userIds = [...spacetime.tables.user_profile.keys()];
    expect(userIds).toHaveLength(1);
    expect(
      [...spacetime.tables.concept_knowledge.values()].every((row) => row.user_id === userIds[0]),
    ).toBe(true);
  });

  it("still records knowledge when SpacetimeDB is disabled", async () => {
    const home = mkdtempSync(join(tmpdir(), "dissect-knowledge-down-"));
    directories.push(home);
    const service = new DissectKnowledgeService(
      home,
      logger,
      new HttpSpacetimeClient(null, logger),
    );
    const state = await service.signal({
      projectId: "proj-a",
      cwd: "/repo",
      kind: "concept",
      key: "middleware",
      action: "know",
    });
    expect(state.concepts.middleware).toBe("comfortable");
  });
});
