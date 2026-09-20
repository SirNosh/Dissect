import { describe, expect, it } from "vitest";
import { matchDissectDiffBlock } from "./match-block";
import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";

const block: DiffBlockDissection = {
  id: "b1",
  path: "app.py",
  title: "Return value",
  summary: "Stores the result before returning it.",
  oldStartLine: 2,
  oldEndLine: 2,
  newStartLine: 2,
  newEndLine: 3,
  whyItChanged: "The added assignment is the actual code change in this block.",
  effect: "Callers still receive 1, now via a named local.",
  conceptKeys: [],
};

describe("matchDissectDiffBlock", () => {
  it("matches new-side lines inside the change block", () => {
    expect(matchDissectDiffBlock([block], "new", 2)?.block.id).toBe("b1");
    expect(matchDissectDiffBlock([block], "new", 3)?.block.id).toBe("b1");
    expect(matchDissectDiffBlock([block], "new", 4)).toBeNull();
  });

  it("matches old-side lines inside the change block", () => {
    expect(matchDissectDiffBlock([block], "old", 2)?.block.id).toBe("b1");
    expect(matchDissectDiffBlock([block], "old", 1)).toBeNull();
  });
});
