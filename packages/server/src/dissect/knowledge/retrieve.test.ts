import { describe, expect, it } from "vitest";
import { retrieveKnowledge, retrievalCacheKey, type KnowledgeCorpus } from "./retrieve.js";

function corpus(overrides: Partial<KnowledgeCorpus> = {}): KnowledgeCorpus {
  return {
    concepts: {},
    components: {},
    conceptPassages: {},
    componentPassages: {},
    ...overrides,
  };
}

describe("retrieveKnowledge", () => {
  it("returns only concepts and components that match the explanation", () => {
    const retrieved = retrieveKnowledge(
      corpus({
        concepts: { jwt: "comfortable", css: "comfortable", middleware: "learning" },
        conceptPassages: {
          jwt: "Signed tokens.",
          middleware: "Wraps a request.",
        },
        components: { src: "comfortable", "src/theme.css": "learning" },
        componentPassages: { src: "Server source.", "src/theme.css": "Colors." },
      }),
      {
        conceptKeys: ["jwt", "middleware"],
        componentPaths: ["src/auth.ts"],
      },
    );

    expect(retrieved.hits.map((hit) => [hit.kind, hit.key, hit.familiarity])).toEqual([
      ["concept", "middleware", "learning"],
      ["concept", "jwt", "comfortable"],
      ["component", "src", "comfortable"],
    ]);
    expect(retrieved.hits[0]?.passage).toBe("Wraps a request.");
  });

  it("matches a concept token in the source without matching inside a longer word", () => {
    const retrieved = retrieveKnowledge(
      corpus({
        concepts: { rest: "comfortable", jwt: "learning" },
      }),
      { text: "restore the session, then verify a jwt" },
    );

    expect(retrieved.hits.map((hit) => hit.key)).toEqual(["jwt"]);
  });

  it("keeps an explained component when the developer has not marked it", () => {
    const retrieved = retrieveKnowledge(
      corpus({
        componentPassages: { "src/auth.ts": "Checks bearer tokens." },
      }),
      { componentPaths: ["src/auth.ts"] },
    );

    expect(retrieved.hits).toEqual([
      {
        kind: "component",
        key: "src/auth.ts",
        familiarity: "introduced",
        passage: "Checks bearer tokens.",
      },
    ]);
  });

  it("prefers learning rows when the match list is capped", () => {
    const concepts: Record<string, "comfortable" | "learning"> = { focus: "learning" };
    for (let index = 0; index < 14; index += 1) {
      concepts[`concept-${String(index).padStart(2, "0")}`] = "comfortable";
    }
    const retrieved = retrieveKnowledge(corpus({ concepts }), {
      conceptKeys: Object.keys(concepts),
    });

    expect(retrieved.hits).toHaveLength(12);
    expect(retrieved.hits[0]?.key).toBe("focus");
    expect(retrieved.hits.slice(1).every((hit) => hit.familiarity === "comfortable")).toBe(true);
  });

  it("keeps the file-cache key stable when only the passage text changes", () => {
    const first = retrieveKnowledge(
      corpus({
        concepts: { jwt: "comfortable" },
        conceptPassages: { jwt: "Signed tokens." },
      }),
      { conceptKeys: ["jwt"] },
    );
    const second = retrieveKnowledge(
      corpus({
        concepts: { jwt: "comfortable" },
        conceptPassages: { jwt: "Signed tokens that expire." },
      }),
      { conceptKeys: ["jwt"] },
    );
    const learned = retrieveKnowledge(
      corpus({
        concepts: { jwt: "learning" },
        conceptPassages: { jwt: "Signed tokens that expire." },
      }),
      { conceptKeys: ["jwt"] },
    );

    expect(first.cacheKey).toBe(second.cacheKey);
    expect(first.cacheKey).not.toBe(learned.cacheKey);
    expect(retrievalCacheKey([])).toBe("none");
  });

  it("returns no hits when nothing in the explanation was stored", () => {
    const retrieved = retrieveKnowledge(
      corpus({ concepts: { jwt: "comfortable" }, components: { src: "comfortable" } }),
      { conceptKeys: ["css"], componentPaths: ["docs/readme.md"], text: "hello" },
    );

    expect(retrieved).toEqual({ hits: [], cacheKey: "none" });
  });
});
