import { describe, expect, it } from "vitest";
import { matchDissectDiffBlock } from "./match-block";
import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";

const block: DiffBlockDissection = {
  id: "b1",
  path: "app.py",
  title: "Return value",
  summary: "Replaced the returned literal with a named local.",
  oldStartLine: 2,
  oldEndLine: 2,
  newStartLine: 2,
  newEndLine: 3,
  whyItChanged: "The added assignment is the actual code change in this block.",
  effect: "Callers still receive 1, now via a named local.",
  conceptKeys: [],
};

describe("matchDissectDiffBlock", () => {
  it("matches added lines inside the change block", () => {
    expect(
      matchDissectDiffBlock([block], { side: "new", lineNumber: 2, type: "add" })?.block.id,
    ).toBe("b1");
    expect(
      matchDissectDiffBlock([block], { side: "new", lineNumber: 3, type: "add" })?.block.id,
    ).toBe("b1");
    expect(matchDissectDiffBlock([block], { side: "new", lineNumber: 4, type: "add" })).toBeNull();
  });

  it("matches removed lines inside the change block", () => {
    expect(
      matchDissectDiffBlock([block], { side: "old", lineNumber: 2, type: "remove" })?.block.id,
    ).toBe("b1");
    expect(
      matchDissectDiffBlock([block], { side: "old", lineNumber: 1, type: "remove" }),
    ).toBeNull();
  });

  it("ignores unchanged context even when the line number sits in the range", () => {
    expect(
      matchDissectDiffBlock([block], { side: "new", lineNumber: 2, type: "context" }),
    ).toBeNull();
    expect(
      matchDissectDiffBlock([block], { side: "old", lineNumber: 2, type: "context" }),
    ).toBeNull();
  });
});
