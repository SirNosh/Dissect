import { describe, expect, it } from "vitest";
import { knowledgeSection } from "./prompts.js";

describe("knowledgeSection", () => {
  it("omits the section when nothing matched", () => {
    expect(knowledgeSection({ hits: [], cacheKey: "none" })).toBe("");
  });

  it("includes the matched passage and the familiarity instruction", () => {
    expect(
      knowledgeSection({
        cacheKey: "x",
        hits: [
          {
            kind: "concept",
            key: "jwt",
            familiarity: "comfortable",
            passage: "Signed tokens.",
          },
        ],
      }),
    ).toBe(`Retrieved developer knowledge for this explanation only:
- jwt (comfortable): Signed tokens. Do not spend space defining this unless the current code uses it in an unusual way; focus on system-level consequences instead.
Never omit essential correctness information just because a concept is marked known.`);
  });
});
