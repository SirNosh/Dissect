import { describe, expect, it } from "vitest";
import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";
import { parseSnapshotUnifiedDiff } from "./parse-unified";
import { alignDiffBlocksToParsedFile, changeSpansFromParsedFile } from "./align-blocks";

const TWO_ISLANDS = `diff --git a/app.py b/app.py
index 1111111..2222222 100644
--- a/app.py
+++ b/app.py
@@ -1,5 +1,6 @@
 def main():
-    return 1
+    value = 1
+    return value
${" "}
 def helper():
-    return 2
+    return 3
`;

const wideBlock: DiffBlockDissection = {
  id: "file",
  path: "app.py",
  title: "File change",
  summary: "Updates both functions.",
  oldStartLine: 1,
  oldEndLine: 8,
  newStartLine: 1,
  newEndLine: 9,
  whyItChanged: "Replaced both return values.",
  effect: "main and helper return different values.",
  conceptKeys: [],
};

describe("changeSpansFromParsedFile", () => {
  it("emits one span per contiguous +/- island", () => {
    const file = parseSnapshotUnifiedDiff({ path: "app.py", unifiedDiff: TWO_ISLANDS });
    expect(file).not.toBeNull();
    if (!file) return;
    expect(changeSpansFromParsedFile(file)).toEqual([
      { oldStartLine: 2, oldEndLine: 2, newStartLine: 2, newEndLine: 3 },
      { oldStartLine: 5, oldEndLine: 5, newStartLine: 6, newEndLine: 6 },
    ]);
  });
});

describe("alignDiffBlocksToParsedFile", () => {
  it("pins a wide stored block onto each exact change island", () => {
    const file = parseSnapshotUnifiedDiff({ path: "app.py", unifiedDiff: TWO_ISLANDS });
    expect(file).not.toBeNull();
    if (!file) return;
    const aligned = alignDiffBlocksToParsedFile([wideBlock], file);
    expect(aligned).toHaveLength(2);
    expect(aligned[0]?.newStartLine).toBe(2);
    expect(aligned[0]?.newEndLine).toBe(3);
    expect(aligned[1]?.oldStartLine).toBe(5);
    expect(aligned[1]?.newStartLine).toBe(6);
    expect(aligned[0]?.whyItChanged).toBe(wideBlock.whyItChanged);
  });
});
