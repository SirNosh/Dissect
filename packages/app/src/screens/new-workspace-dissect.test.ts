import { describe, expect, it, vi } from "vitest";
import { runCreateDissectWorkspace } from "./new-workspace-dissect";

describe("runCreateDissectWorkspace", () => {
  it("creates a workspace without a chat agent and navigates to Dissect", async () => {
    const workspace = { id: "workspace-123", workspaceDirectory: "/repo/workspace-123" };
    const ensureWorkspace = vi.fn().mockResolvedValue(workspace);
    const recorded: Array<{ serverId: string; workspaceId: string; target: unknown }> = [];

    const result = await runCreateDissectWorkspace({
      cwd: "/repo",
      ensureWorkspace,
      serverId: "server-abc",
      navigate: (serverId, workspaceId, target) => {
        recorded.push({ serverId, workspaceId, target });
      },
    });

    expect(ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/repo",
      prompt: "",
      attachments: [],
      withInitialAgent: false,
    });
    expect(recorded).toEqual([
      {
        serverId: "server-abc",
        workspaceId: "workspace-123",
        target: { kind: "dissect" },
      },
    ]);
    expect(result).toEqual(workspace);
  });
});
