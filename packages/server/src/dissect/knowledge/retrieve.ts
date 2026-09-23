import type { DissectFamiliarity } from "@getpaseo/protocol/dissect";
import { sha256Hex } from "../repository/hash.js";

/** How many matching knowledge rows a single prompt may see. */
const MAX_RETRIEVED_HITS = 12;
const PROMPT_PASSAGE_CHARS = 400;
export const STORED_PASSAGE_CHARS = 800;

const FAMILIARITY_RANK: Record<DissectFamiliarity, number> = {
  learning: 0,
  comfortable: 1,
  introduced: 2,
  unseen: 3,
};

export interface KnowledgeCorpus {
  concepts: Readonly<Record<string, DissectFamiliarity>>;
  components: Readonly<Record<string, DissectFamiliarity>>;
  conceptPassages: Readonly<Record<string, string>>;
  componentPassages: Readonly<Record<string, string>>;
}

export interface KnowledgeQuery {
  conceptKeys?: readonly string[];
  componentPaths?: readonly string[];
  /** Source, diff, or question text. Concept keys found as tokens are included. */
  text?: string;
}

export interface RetrievedKnowledgeHit {
  kind: "concept" | "component";
  key: string;
  familiarity: DissectFamiliarity;
  passage: string | null;
}

export interface RetrievedKnowledge {
  hits: RetrievedKnowledgeHit[];
  /** Familiarity and keys only, so rewriting a passage does not bust the file cache. */
  cacheKey: string;
}

export interface KnowledgeRetriever {
  retrieve(query: KnowledgeQuery): RetrievedKnowledge;
}

export function normalizePassage(text: string, maxChars: number): string | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

/**
 * Intersect stored familiarity and last-shown passages with the paths and
 * concept keys of the explanation being generated.
 */
export function retrieveKnowledge(
  corpus: KnowledgeCorpus,
  query: KnowledgeQuery,
): RetrievedKnowledge {
  const hits = [...matchingConcepts(corpus, query), ...matchingComponents(corpus, query)];
  hits.sort(compareHits);
  const capped = hits.slice(0, MAX_RETRIEVED_HITS);
  return { hits: capped, cacheKey: retrievalCacheKey(capped) };
}

export function retrievalCacheKey(hits: readonly RetrievedKnowledgeHit[]): string {
  if (hits.length === 0) return "none";
  const canonical = hits.map((hit) => `${hit.kind}\t${hit.key}\t${hit.familiarity}`).join("\n");
  return sha256Hex(canonical);
}

function matchingConcepts(corpus: KnowledgeCorpus, query: KnowledgeQuery): RetrievedKnowledgeHit[] {
  const requested = new Set(
    (query.conceptKeys ?? [])
      .map((key) => key.trim().toLowerCase())
      .filter((key) => key.length > 0),
  );
  const haystack = query.text?.toLowerCase() ?? "";
  const hits: RetrievedKnowledgeHit[] = [];
  const seen = new Set<string>();
  for (const [key, familiarity] of Object.entries(corpus.concepts)) {
    considerConcept(hits, seen, key, familiarity, corpus.conceptPassages[key], requested, haystack);
  }
  for (const [key, passage] of Object.entries(corpus.conceptPassages)) {
    if (corpus.concepts[key] !== undefined) continue;
    considerConcept(hits, seen, key, undefined, passage, requested, haystack);
  }
  return hits;
}

function considerConcept(
  hits: RetrievedKnowledgeHit[],
  seen: Set<string>,
  key: string,
  familiarity: DissectFamiliarity | undefined,
  passage: string | undefined,
  requested: ReadonlySet<string>,
  haystack: string,
): void {
  const lookup = key.trim().toLowerCase();
  if (lookup.length === 0 || seen.has(lookup)) return;
  const named = requested.has(lookup);
  const mentioned =
    haystack.length > 0 && lookup.length >= 3 && textIncludesToken(haystack, lookup);
  if (!named && !mentioned) return;
  const active = activeFamiliarity(familiarity, passage);
  if (!active) return;
  seen.add(lookup);
  hits.push({
    kind: "concept",
    key: key.trim(),
    familiarity: active,
    passage: passage ? normalizePassage(passage, PROMPT_PASSAGE_CHARS) : null,
  });
}

function matchingComponents(
  corpus: KnowledgeCorpus,
  query: KnowledgeQuery,
): RetrievedKnowledgeHit[] {
  const paths = (query.componentPaths ?? []).map(normalizePath).filter((path) => path.length > 0);
  if (paths.length === 0) return [];
  const hits: RetrievedKnowledgeHit[] = [];
  const seen = new Set<string>();
  const passages = corpus.componentPassages;
  for (const [key, familiarity] of Object.entries(corpus.components)) {
    considerComponent(hits, seen, paths, key, familiarity, passages[key]);
  }
  for (const [key, passage] of Object.entries(passages)) {
    if (corpus.components[key] !== undefined) continue;
    considerComponent(hits, seen, paths, key, undefined, passage);
  }
  return hits;
}

function considerComponent(
  hits: RetrievedKnowledgeHit[],
  seen: Set<string>,
  queryPaths: readonly string[],
  key: string,
  familiarity: DissectFamiliarity | undefined,
  passage: string | undefined,
): void {
  const stored = normalizePath(key);
  if (stored.length === 0 || seen.has(stored)) return;
  const covers = queryPaths.some((queryPath) => componentCovers(stored, queryPath));
  if (!covers) return;
  const active = activeFamiliarity(familiarity, passage);
  if (!active) return;
  seen.add(stored);
  hits.push({
    kind: "component",
    key: stored,
    familiarity: active,
    passage: passage ? normalizePassage(passage, PROMPT_PASSAGE_CHARS) : null,
  });
}

function activeFamiliarity(
  familiarity: DissectFamiliarity | undefined,
  passage: string | undefined,
): DissectFamiliarity | null {
  if (familiarity === "learning" || familiarity === "comfortable" || familiarity === "introduced") {
    return familiarity;
  }
  if (familiarity === undefined && passage && passage.trim().length > 0) return "introduced";
  return null;
}

function compareHits(left: RetrievedKnowledgeHit, right: RetrievedKnowledgeHit): number {
  const rank = FAMILIARITY_RANK[left.familiarity] - FAMILIARITY_RANK[right.familiarity];
  if (rank !== 0) return rank;
  if (left.kind !== right.kind) return left.kind === "concept" ? -1 : 1;
  return left.key.localeCompare(right.key);
}

function componentCovers(stored: string, query: string): boolean {
  if (stored === query) return true;
  if (stored === ".") return true;
  return query.startsWith(`${stored}/`);
}

function normalizePath(path: string): string {
  const trimmed = path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (trimmed.length === 0 || trimmed === ".") return ".";
  return trimmed.replace(/\/+$/, "");
}

function textIncludesToken(haystack: string, needle: string): boolean {
  let from = 0;
  while (from < haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : haystack[at - 1];
    const afterIndex = at + needle.length;
    const after = afterIndex >= haystack.length ? "" : haystack[afterIndex];
    if (!isTokenChar(before) && !isTokenChar(after)) return true;
    from = at + 1;
  }
  return false;
}

function isTokenChar(char: string): boolean {
  return /^[a-z0-9]$/.test(char);
}
