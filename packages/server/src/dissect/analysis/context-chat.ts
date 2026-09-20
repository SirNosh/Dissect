import type {
  ArchitectureGraph,
  CodebaseDissection,
  DissectContextAnswer,
  DissectKnowledgeState,
} from "@getpaseo/protocol/dissect";
import type { DissectTextProvider } from "../providers/provider.js";
import { callStructured } from "../providers/provider.js";
import { buildContextQuestionPrompt } from "../providers/prompts.js";
import { readRepositoryFile } from "../repository/inventory.js";
import { RawContextAnswerSchema } from "./schemas.js";

const MAX_CONTEXT_FILE_BYTES = 12_000;
const MAX_CONTEXT_TOTAL_BYTES = 60_000;

/**
 * Contextual folder/file question answering. Context is assembled strictly
 * from the stored dissection plus current repository file contents — never
 * from any coding-agent conversation.
 *
 * Folder path "." is the architecture / whole-codebase scope used by the
 * Dissect pane chat on the overview screen.
 */
export async function answerContextQuestion(input: {
  cwd: string;
  run: CodebaseDissection;
  scopeKind: "folder" | "file";
  scopePath: string;
  question: string;
  provider: DissectTextProvider;
  knowledge: DissectKnowledgeState;
}): Promise<DissectContextAnswer> {
  const { run, scopePath } = input;
  const codebaseScope = input.scopeKind === "folder" && (scopePath === "." || scopePath === "");
  const sections = collectContextSections({
    run,
    scopeKind: input.scopeKind,
    scopePath,
    codebaseScope,
  });
  const scopedFilePaths = collectScopedFilePaths({
    run,
    scopeKind: input.scopeKind,
    scopePath,
    codebaseScope,
  });

  let budget = MAX_CONTEXT_TOTAL_BYTES;
  for (const path of scopedFilePaths.slice(0, 12)) {
    if (budget <= 0) break;
    const read = await readRepositoryFile(
      input.cwd,
      path,
      Math.min(MAX_CONTEXT_FILE_BYTES, budget),
    );
    if (!read) continue;
    const block = `--- ${path} ---\n${read.content}${read.truncated ? "\n[... truncated ...]" : ""}`;
    sections.push(block);
    budget -= Buffer.byteLength(block, "utf8");
  }

  const prompt = buildContextQuestionPrompt({
    scopeKind: input.scopeKind,
    scopePath: codebaseScope ? "codebase architecture" : scopePath,
    context: sections.join("\n\n"),
    question: input.question,
    knowledge: input.knowledge,
  });
  const raw = await callStructured(input.provider, RawContextAnswerSchema, prompt);

  const validPaths = new Set(run.files.map((file) => file.path));
  return {
    markdown: raw.markdown,
    references: raw.references.filter((reference) => validPaths.has(reference.path)),
    concepts: raw.concepts,
  };
}

function collectContextSections(input: {
  run: CodebaseDissection;
  scopeKind: "folder" | "file";
  scopePath: string;
  codebaseScope: boolean;
}): string[] {
  const { run, scopePath } = input;
  const sections: string[] = [`Codebase summary: ${run.summary}`];

  if (input.codebaseScope) {
    if (run.graph.nodes.length > 0) {
      sections.push(
        `Architecture nodes:\n${run.graph.nodes
          .map((node) => `${node.label} [${node.kind}] ${node.path ?? node.id}: ${node.summary}`)
          .join("\n")}`,
      );
    }
    const edgeLines = formatEdges(run.graph, () => true);
    if (edgeLines.length > 0) {
      sections.push(`Architecture relationships:\n${edgeLines.join("\n")}`);
    }
    if (run.folders.length > 0) {
      sections.push(
        `Folders:\n${run.folders
          .map(
            (folder) =>
              `${folder.path === "." ? "/" : folder.path} — ${folder.role}: ${folder.summary}`,
          )
          .join("\n")}`,
      );
    }
    if (run.files.length > 0) {
      sections.push(
        `File summaries:\n${run.files
          .map((file) => `${file.path} — ${file.role}: ${file.summary}`)
          .join("\n")}`,
      );
    }
    if (run.concepts.length > 0) {
      sections.push(
        `Concepts:\n${run.concepts
          .map((concept) => `${concept.label} (${concept.key}): ${concept.explanation}`)
          .join("\n")}`,
      );
    }
    return sections;
  }

  const folder =
    input.scopeKind === "folder"
      ? run.folders.find((entry) => entry.path === scopePath)
      : run.folders.find((entry) => entry.files.some((file) => file === scopePath));
  if (folder) {
    sections.push(
      `Folder ${folder.path}: ${folder.role ? `${folder.role}. ` : ""}${folder.summary}`,
    );
  }

  const edgeLines = formatEdges(run.graph, (path) =>
    Boolean(
      path &&
      (scopePath === path || scopePath.startsWith(`${path}/`) || path.startsWith(`${scopePath}/`)),
    ),
  );
  if (edgeLines.length > 0) {
    sections.push(`Architecture relationships:\n${edgeLines.join("\n")}`);
  }

  const scopedFilePaths = collectScopedFilePaths(input);
  const summariesInScope = run.files.filter((file) => scopedFilePaths.includes(file.path));
  if (summariesInScope.length > 0) {
    sections.push(
      `File summaries:\n${summariesInScope
        .map((file) => `${file.path} — ${file.role}: ${file.summary}`)
        .join("\n")}`,
    );
  }
  return sections;
}

function collectScopedFilePaths(input: {
  run: CodebaseDissection;
  scopeKind: "folder" | "file";
  scopePath: string;
  codebaseScope: boolean;
}): string[] {
  const { run, scopePath } = input;
  if (input.scopeKind === "file") return [scopePath];
  if (input.codebaseScope) {
    const fromGraph = run.graph.nodes
      .map((node) => node.path)
      .filter(
        (path): path is string => Boolean(path) && run.files.some((file) => file.path === path),
      );
    const unique = [...new Set(fromGraph)];
    if (unique.length > 0) return unique;
    return run.files.map((file) => file.path);
  }
  const folder = run.folders.find((entry) => entry.path === scopePath);
  if (folder) return folder.files;
  return run.files
    .map((file) => file.path)
    .filter((path) => {
      const slash = path.lastIndexOf("/");
      const parent = slash === -1 ? "." : path.slice(0, slash);
      return parent === scopePath;
    });
}

function formatEdges(
  graph: ArchitectureGraph,
  includePath: (path: string | null) => boolean,
): string[] {
  return graph.edges
    .map((edge) => {
      const from = graph.nodes.find((node) => node.id === edge.from);
      const to = graph.nodes.find((node) => node.id === edge.to);
      if (!from || !to) return null;
      if (!includePath(from.path) && !includePath(to.path)) return null;
      return `${from.label} -> ${to.label} (${edge.kind}${edge.label ? `: ${edge.label}` : ""})`;
    })
    .filter((line): line is string => line !== null);
}
