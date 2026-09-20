import { describe, expect, it } from "vitest";
import { parseSnapshotUnifiedDiff } from "./parse-unified";

const MODIFIED = `diff --git a/app.py b/app.py
index 1111111..2222222 100644
--- a/app.py
+++ b/app.py
@@ -1,3 +1,4 @@
 def main():
-    return 1
+    value = 1
+    return value
`;

const ADDED = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const n = 1;
+
`;

describe("parseSnapshotUnifiedDiff", () => {
  it("parses a modified file and keeps the requested path", () => {
    const file = parseSnapshotUnifiedDiff({ path: "app.py", unifiedDiff: MODIFIED });
    expect(file?.path).toBe("app.py");
    expect(file?.isNew).toBe(false);
    expect(file?.isDeleted).toBe(false);
    expect(file?.additions).toBe(2);
    expect(file?.deletions).toBe(1);
    expect(file?.hunks[0]?.oldStart).toBe(1);
    expect(file?.hunks[0]?.newStart).toBe(1);
    expect(file?.hunks[0]?.lines.map((line) => line.type)).toEqual([
      "header",
      "context",
      "remove",
      "add",
      "add",
    ]);
  });

  it("parses an added file", () => {
    const file = parseSnapshotUnifiedDiff({ path: "new.ts", unifiedDiff: ADDED });
    expect(file?.isNew).toBe(true);
    expect(file?.additions).toBe(2);
    expect(file?.hunks[0]?.lines.some((line) => line.content.includes("export const n"))).toBe(
      true,
    );
  });

  it("returns null for an empty diff", () => {
    expect(parseSnapshotUnifiedDiff({ path: "app.py", unifiedDiff: "" })).toBeNull();
  });
});
