import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodebaseDissection } from "@getpaseo/protocol/dissect";
import { createTestLogger } from "../test-utils/test-logger.js";
import { DissectService } from "./service.js";
import { DissectProjectStore } from "./store.js";

const logger = createTestLogger();

function minimalRun(cwd: string): CodebaseDissection {
  return {
    runId: "run-1",
    projectId: "proj",
    workspaceId: cwd,
    snapshotId: "seed",
    generatedAt: new Date().toISOString(),
    summary: "seed",
    graph: { nodes: [], edges: [] },
    folders: [],
    files: [],
    concepts: [],
  };
}

describe("DissectService agent-turn snapshots", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), "dissect-turn-"));
    directories.push(directory);
    return directory;
  }

  function createGitWorkspace(): string {
    const cwd = createDirectory();
    execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 1;\n");
    return cwd;
  }

  async function seedRun(paseoHome: string, cwd: string): Promise<void> {
    const store = new DissectProjectStore(paseoHome, logger);
    await store.save(cwd, (state) => {
      state.run = minimalRun(cwd);
      state.baselineSnapshotId = "seed";
    });
  }

  it("ignores turn boundaries until a full Dissect exists", async () => {
    const paseoHome = createDirectory();
    const cwd = createGitWorkspace();
    const service = new DissectService(paseoHome, logger);

    await service.recordAgentTurnStart(cwd);
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 2;\n");
    await service.recordAgentTurnEnd(cwd);

    const changes = await service.checkChanges(cwd);
    expect(changes.changed).toBe(false);
  });

  it("records only the latest agent-turn file delta", async () => {
    const paseoHome = createDirectory();
    const cwd = createGitWorkspace();
    await seedRun(paseoHome, cwd);
    const service = new DissectService(paseoHome, logger);

    await service.recordAgentTurnStart(cwd);
    expect((await service.checkChanges(cwd)).changed).toBe(false);

    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 2;\n");
    await service.recordAgentTurnEnd(cwd);

    const afterTurn = await service.checkChanges(cwd);
    expect(afterTurn.changed).toBe(true);
    expect(afterTurn.snapshotId).toBeTruthy();
    expect(afterTurn.baselineSnapshotId).toBeTruthy();
    expect(afterTurn.snapshotId).not.toBe(afterTurn.baselineSnapshotId);
  });

  it("returns a per-file unified diff between turn snapshots", async () => {
    const paseoHome = createDirectory();
    const cwd = createGitWorkspace();
    await seedRun(paseoHome, cwd);
    const service = new DissectService(paseoHome, logger);

    await service.recordAgentTurnStart(cwd);
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 2;\n");
    await service.recordAgentTurnEnd(cwd);

    const changes = await service.checkChanges(cwd);
    if (!changes.baselineSnapshotId || !changes.snapshotId) {
      throw new Error("expected agent-turn snapshot ids");
    }
    const unifiedDiff = await service.getDiffFile({
      cwd,
      path: "src/app.ts",
      fromSnapshotId: changes.baselineSnapshotId,
      toSnapshotId: changes.snapshotId,
    });
    expect(unifiedDiff).toContain("src/app.ts");
    expect(unifiedDiff).toContain("-export const n = 1;");
    expect(unifiedDiff).toContain("+export const n = 2;");
  });

  it("rejects path traversal in getDiffFile", async () => {
    const paseoHome = createDirectory();
    const cwd = createGitWorkspace();
    const service = new DissectService(paseoHome, logger);
    await expect(
      service.getDiffFile({
        cwd,
        path: "../secret",
        fromSnapshotId: "a".repeat(40),
        toSnapshotId: "b".repeat(40),
      }),
    ).rejects.toThrow("Invalid diff path");
  });
});
