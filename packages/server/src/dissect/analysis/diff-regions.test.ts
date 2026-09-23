import { describe, expect, it } from "vitest";
import {
  attachExplanationsToRegions,
  extractDiffChangeRegions,
  renderDiffChangeRegions,
} from "./diff-regions.js";

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

const ADDED_FILE = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const n = 1;
+
`;

describe("extractDiffChangeRegions", () => {
  it("splits one hunk into a region per contiguous +/- island", () => {
    const regions = extractDiffChangeRegions(TWO_ISLANDS);
    expect(regions).toEqual([
      {
        id: "r1",
        path: "app.py",
        oldStartLine: 2,
        oldEndLine: 2,
        newStartLine: 2,
        newEndLine: 3,
        patch: "-    return 1\n+    value = 1\n+    return value",
      },
      {
        id: "r2",
        path: "app.py",
        oldStartLine: 5,
        oldEndLine: 5,
        newStartLine: 6,
        newEndLine: 6,
        patch: "-    return 2\n+    return 3",
      },
    ]);
  });

  it("covers added-file lines only on the new side", () => {
    const regions = extractDiffChangeRegions(ADDED_FILE);
    expect(regions).toEqual([
      {
        id: "r1",
        path: "new.ts",
        oldStartLine: undefined,
        oldEndLine: undefined,
        newStartLine: 1,
        newEndLine: 2,
        patch: "+export const n = 1;\n+",
      },
    ]);
  });
});

describe("attachExplanationsToRegions", () => {
  it("keeps the region's exact line ranges and matches explanations by id", () => {
    const regions = extractDiffChangeRegions(TWO_ISLANDS);
    const blocks = attachExplanationsToRegions({
      regions,
      explanations: [
        {
          id: "r2",
          path: "app.py",
          title: "Helper return",
          summary: "Changed helper's return from 2 to 3.",
          whyItChanged: "Replaced `return 2` with `return 3`.",
          effect: "helper() now returns 3.",
          conceptKeys: [],
        },
        {
          id: "r1",
          path: "app.py",
          title: "Named return",
          summary: "Stores 1 in a local before returning it.",
          whyItChanged: "Replaced `return 1` with an assignment and `return value`.",
          effect: "main() still returns 1.",
          conceptKeys: [],
        },
      ],
    });
    expect(blocks.map((block) => block.id)).toEqual(["r1", "r2"]);
    expect(blocks[0]?.oldStartLine).toBe(2);
    expect(blocks[0]?.newEndLine).toBe(3);
    expect(blocks[0]?.whyItChanged).toContain("return 1");
    expect(blocks[1]?.oldStartLine).toBe(5);
    expect(blocks[1]?.newStartLine).toBe(6);
  });

  it("renders region listings with the exact patch lines", () => {
    const rendered = renderDiffChangeRegions(extractDiffChangeRegions(TWO_ISLANDS));
    expect(rendered).toContain("### r1  app.py");
    expect(rendered).toContain("-    return 1");
    expect(rendered).toContain("+    value = 1");
    expect(rendered).toContain("### r2  app.py");
  });
});
