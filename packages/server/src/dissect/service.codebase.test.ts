import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import { startGitCommandMetrics, stopGitCommandMetrics } from "../utils/run-git-command.js";
import type { DissectTextProvider } from "./providers/provider.js";
import { DissectService } from "./service.js";
import { MemorySpacetimeClient } from "./spacetime/client.js";

const logger = createTestLogger();

function createFakeProvider(): DissectTextProvider {
  return {
    async complete(input) {
      const user = input.messages.find((message) => message.role === "user")?.content ?? "";
      if (user.includes("Summarize each of the following local workspace files")) {
        return JSON.stringify({
          files: [
            {
              path: "src/app.ts",
              role: "module",
              summary: "Exports a constant.",
              exports: ["n"],
              imports: [],
              importantSymbols: ["n"],
              conceptKeys: [],
            },
          ],
        });
      }
      return JSON.stringify({
        summary: "A tiny local workspace.",
        graph: {
          nodes: [
            {
              id: "src",
              label: "src",
              path: "src",
              kind: "directory",
              summary: "Application source.",
            },
          ],
          edges: [],
        },
        folders: [{ path: "src", role: "source", summary: "Application source.", conceptKeys: [] }],
        concepts: [],
      });
    },
  };
}

describe("DissectService initial codebase dissection", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("analyzes a non-git folder from local files and never snapshots HEAD", async () => {
    const paseoHome = mkdtempSync(join(tmpdir(), "dissect-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dissect-local-"));
    directories.push(paseoHome, cwd);
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 1;\n");

    const service = new DissectService(paseoHome, logger, createFakeProvider());
    const stages: string[] = [];
    startGitCommandMetrics();
    const result = await service.runCodebaseDissection(cwd, (event) => {
      if (stages.at(-1) !== event.stage) stages.push(event.stage);
    });
    const metrics = stopGitCommandMetrics();

    expect(result.baselineSnapshotId.startsWith("local:")).toBe(true);
    expect(result.run.snapshotId).toBe(result.baselineSnapshotId);
    expect(stages).toEqual(["inventory", "file_summaries", "architecture", "done"]);
    expect(
      metrics.commands.filter(
        (command) => command.args[0] === "rev-parse" && command.args.includes("HEAD"),
      ),
    ).toEqual([]);
    expect(metrics.commands.filter((command) => command.args[0] === "write-tree")).toEqual([]);
  });

  it("caches the first architecture in SpacetimeDB and restores it without re-analyzing", async () => {
    const paseoHome = mkdtempSync(join(tmpdir(), "dissect-home-"));
    const laterHome = mkdtempSync(join(tmpdir(), "dissect-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "dissect-local-"));
    directories.push(paseoHome, laterHome, cwd);
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 1;\n");

    const spacetime = new MemorySpacetimeClient();
    const first = new DissectService(paseoHome, logger, createFakeProvider(), spacetime);
    const created = await first.runCodebaseDissection(cwd, () => undefined);
    expect(spacetime.architectures.size).toBe(1);

    const backfill = new MemorySpacetimeClient();
    const fromDisk = new DissectService(paseoHome, logger, createFakeProvider(), backfill);
    await fromDisk.getState(cwd);
    expect(JSON.parse(String([...backfill.architectures.values()][0].payload_json)).runId).toBe(
      created.run.runId,
    );

    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 99;\n");
    const second = new DissectService(paseoHome, logger, createFakeProvider(), spacetime);
    await second.runCodebaseDissection(cwd, () => undefined);
    const cached = [...spacetime.architectures.values()][0];
    expect(JSON.parse(String(cached.payload_json)).runId).toBe(created.run.runId);

    const restored = new DissectService(laterHome, logger, createFakeProvider(), spacetime);
    const state = await restored.getState(cwd);
    expect(state.run?.runId).toBe(created.run.runId);
    expect(state.run?.summary).toBe("A tiny local workspace.");
  });
});
