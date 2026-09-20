import { describe, expect, it } from "vitest";
import type { CodebaseDissection } from "@getpaseo/protocol/dissect";
import { MemorySpacetimeClient } from "./client.js";
import {
  enqueueCodebaseArchitectureCache,
  loadCachedCodebaseArchitecture,
} from "./architecture-cache.js";

function sampleRun(runId: string): CodebaseDissection {
  return {
    runId,
    projectId: "proj",
    workspaceId: "/tmp/ws",
    snapshotId: "local:proj",
    generatedAt: "2026-09-20T00:00:00.000Z",
    summary: "cached",
    graph: { nodes: [], edges: [] },
    folders: [],
    files: [],
    concepts: [],
  };
}

describe("codebase architecture SpacetimeDB cache", () => {
  it("stores the first architecture and ignores a second write", async () => {
    const client = new MemorySpacetimeClient();
    const first = sampleRun("run-1");
    enqueueCodebaseArchitectureCache(client, {
      projectId: "proj-a",
      snapshotId: first.snapshotId,
      run: first,
    });
    enqueueCodebaseArchitectureCache(client, {
      projectId: "proj-a",
      snapshotId: "local:other",
      run: sampleRun("run-2"),
    });
    const cached = await loadCachedCodebaseArchitecture(client, "proj-a");
    expect(cached?.run.runId).toBe("run-1");
    expect(cached?.snapshotId).toBe("local:proj");
  });

  it("returns null when the project has no cached architecture", async () => {
    const client = new MemorySpacetimeClient();
    expect(await loadCachedCodebaseArchitecture(client, "missing")).toBeNull();
  });
});
