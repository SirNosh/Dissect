import { describe, expect, it } from "vitest";
import { agentTurnHasFileChanges, resolveAgentTurnDiffSnapshots } from "./agent-turn.js";

describe("agentTurnHasFileChanges", () => {
  it("is true only when a completed turn produced a different snapshot", () => {
    expect(agentTurnHasFileChanges(null)).toBe(false);
    expect(agentTurnHasFileChanges({ fromSnapshotId: "a", toSnapshotId: null })).toBe(false);
    expect(agentTurnHasFileChanges({ fromSnapshotId: "a", toSnapshotId: "a" })).toBe(false);
    expect(agentTurnHasFileChanges({ fromSnapshotId: "a", toSnapshotId: "b" })).toBe(true);
  });
});

describe("resolveAgentTurnDiffSnapshots", () => {
  it("requires a prior full Dissect", () => {
    expect(() =>
      resolveAgentTurnDiffSnapshots({
        hasCodebaseRun: false,
        agentTurn: { fromSnapshotId: "a", toSnapshotId: "b" },
      }),
    ).toThrow(/full Dissect first/);
  });

  it("requires a completed agent turn with file changes", () => {
    expect(() => resolveAgentTurnDiffSnapshots({ hasCodebaseRun: true, agentTurn: null })).toThrow(
      /agent-turn file changes/,
    );
    expect(() =>
      resolveAgentTurnDiffSnapshots({
        hasCodebaseRun: true,
        agentTurn: { fromSnapshotId: "a", toSnapshotId: "a" },
      }),
    ).toThrow(/did not change any files/);
  });

  it("returns the latest agent-turn snapshots", () => {
    expect(
      resolveAgentTurnDiffSnapshots({
        hasCodebaseRun: true,
        agentTurn: { fromSnapshotId: "before", toSnapshotId: "after" },
      }),
    ).toEqual({ fromSnapshotId: "before", toSnapshotId: "after" });
  });
});
