import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DissectKnowledgeState } from "@getpaseo/protocol/dissect";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { DissectTextProvider } from "../providers/provider.js";
import { analyzeCodebase } from "./codebase.js";

const logger = createTestLogger();

const emptyKnowledge: DissectKnowledgeState = {
  revision: 0,
  concepts: {},
  components: {},
};

function recordingProvider(label: string, calls: string[]): DissectTextProvider {
  return {
    async complete(input) {
      const user = input.messages.find((message) => message.role === "user")?.content ?? "";
      let kind = "other";
      if (user.includes("Summarize each of the following local workspace files")) {
        kind = "summaries";
      } else if (user.includes("high-level architecture explanation")) {
        kind = "architecture";
      }
      calls.push(`${label}:${kind}`);
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

describe("analyzeCodebase provider split", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("sends file summaries to Gemini and architecture to Grok", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "dissect-split-"));
    directories.push(cwd);
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export const n = 1;\n");

    const calls: string[] = [];
    await analyzeCodebase({
      cwd,
      snapshotId: "local:test",
      projectId: "prj_test",
      provider: recordingProvider("gemini", calls),
      architectureProvider: recordingProvider("grok", calls),
      knowledge: emptyKnowledge,
      logger,
      onProgress: () => undefined,
    });

    expect(calls).toContain("gemini:summaries");
    expect(calls).toContain("grok:architecture");
    expect(calls).not.toContain("gemini:architecture");
    expect(calls).not.toContain("grok:summaries");
  });
});
