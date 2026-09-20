import { describe, expect, it, vi } from "vitest";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { resolveDissectDiffGetFile } from "./fetch-dissect-diff-file";

describe("resolveDissectDiffGetFile", () => {
  it("uses the instance method when the live client already has it", async () => {
    const dissectDiffGetFile = vi.fn(async () => ({
      requestId: "req-1",
      unifiedDiff: "diff --git a/app.py b/app.py\n",
      error: null,
    }));
    const client = { dissectDiffGetFile } as unknown as DaemonClient;
    const getFile = resolveDissectDiffGetFile(client);
    const payload = await getFile("/workspace", {
      path: "app.py",
      fromSnapshotId: "from",
      toSnapshotId: "to",
    });
    expect(dissectDiffGetFile.mock.calls).toEqual([
      ["/workspace", { path: "app.py", fromSnapshotId: "from", toSnapshotId: "to" }],
    ]);
    expect(payload.unifiedDiff).toBe("diff --git a/app.py b/app.py\n");
  });

  it("binds the current DaemonClient method onto a stale connected instance", () => {
    const stale = { dissectDiffStart: async () => undefined } as unknown as DaemonClient;
    const getFile = resolveDissectDiffGetFile(stale);
    expect(typeof getFile).toBe("function");
    expect(typeof (stale as { dissectDiffGetFile?: unknown }).dissectDiffGetFile).toBe("undefined");
    expect(typeof DaemonClient.prototype.dissectDiffGetFile).toBe("function");
  });
});
