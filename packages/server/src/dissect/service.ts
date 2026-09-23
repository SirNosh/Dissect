import type pino from "pino";
import type {
  CodebaseDissection,
  DiffDissection,
  DissectContextAnswer,
  DissectKnowledgeState,
  DissectWorkspaceState,
  FileDissection,
  FolderDissection,
} from "@getpaseo/protocol/dissect";
import { expandTilde } from "../utils/path.js";
import { analyzeCodebase, type CodebaseProgressEvent } from "./analysis/codebase.js";
import { analyzeDiff } from "./analysis/diff.js";
import { analyzeFile } from "./analysis/file.js";
import { answerContextQuestion } from "./analysis/context-chat.js";
import { DissectKnowledgeService } from "./knowledge/service.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { overlayDissectLlmEnvFromCheckout } from "./providers/llm-env.js";
import { resolveDissectAnalysisConfigs, type DissectTextProvider } from "./providers/provider.js";
import { captureWorkingTreeSnapshot, assertGitTreeSha } from "./snapshot/git-tree-snapshot.js";
import { unifiedDiffBetweenSnapshots } from "./snapshot/diff-between-snapshots.js";
import { readRepositoryFile } from "./repository/inventory.js";
import { MAX_ANALYZABLE_FILE_BYTES } from "./repository/filters.js";
import { sha256Hex } from "./repository/hash.js";
import { agentTurnHasFileChanges, resolveAgentTurnDiffSnapshots } from "./agent-turn.js";
import { DissectProjectStore } from "./store.js";
import {
  HttpSpacetimeClient,
  resolveSpacetimeConfigFromProcess,
  type DissectSpacetimeClient,
} from "./spacetime/client.js";
import { enqueueCodebaseArchitectureCache } from "./spacetime/architecture-cache.js";

export type DissectProgressStage = CodebaseProgressEvent["stage"] | "diff";

export interface DissectProgressEvent {
  stage: DissectProgressStage;
  detail: string | null;
  completed: number | null;
  total: number | null;
}

/**
 * Daemon-global Dissect service. All analysis is explicit: nothing here runs
 * on file changes, and nothing here ever reads a coding-agent transcript.
 */
export class DissectService {
  private readonly store: DissectProjectStore;
  private readonly knowledge: DissectKnowledgeService;
  private readonly spacetime: DissectSpacetimeClient;
  private readonly runsInFlight = new Set<string>();

  constructor(
    paseoHome: string,
    private readonly logger: pino.Logger,
    private readonly analysisProvider?: DissectTextProvider,
    spacetime?: DissectSpacetimeClient,
  ) {
    this.spacetime =
      spacetime ??
      new HttpSpacetimeClient(
        resolveSpacetimeConfigFromProcess(),
        logger.child({ spacetime: true }),
      );
    this.store = new DissectProjectStore(paseoHome, logger, this.spacetime);
    this.knowledge = new DissectKnowledgeService(paseoHome, logger, this.spacetime);
  }

  private resolveProviders(): {
    code: DissectTextProvider | null;
    architecture: DissectTextProvider | null;
    hint: string | null;
  } {
    if (this.analysisProvider) {
      return { code: this.analysisProvider, architecture: this.analysisProvider, hint: null };
    }
    const { code, architecture, hint } = resolveDissectAnalysisConfigs(
      overlayDissectLlmEnvFromCheckout(process.env),
    );
    return {
      code: code ? new OpenAICompatibleProvider(code) : null,
      architecture: architecture ? new OpenAICompatibleProvider(architecture) : null,
      hint,
    };
  }

  private requireCodeProvider(): DissectTextProvider {
    const { code, hint } = this.resolveProviders();
    if (!code) {
      throw new Error(hint ?? "Dissect needs a Gemini API key for file-level analysis.");
    }
    return code;
  }

  private requireArchitectureProvider(): DissectTextProvider {
    const { architecture, hint } = this.resolveProviders();
    if (!architecture) {
      throw new Error(hint ?? "Dissect needs a Grok API key for architecture maps.");
    }
    return architecture;
  }

  private normalizeCwd(cwd: string): string {
    return expandTilde(cwd);
  }

  async getState(cwd: string): Promise<DissectWorkspaceState> {
    const resolved = this.normalizeCwd(cwd);
    const state = await this.store.load(resolved);
    const { code, architecture, hint } = this.resolveProviders();
    const knowledge = await this.knowledge.getState(this.store.projectId(resolved), resolved);
    return {
      configured: code !== null && architecture !== null,
      configurationHint: hint,
      run: state.run,
      lastDiff: state.lastDiff,
      baselineSnapshotId: state.baselineSnapshotId,
      changed: agentTurnHasFileChanges(state.agentTurn),
      knowledge,
    };
  }

  async checkChanges(cwd: string): Promise<{
    changed: boolean;
    snapshotId: string | null;
    baselineSnapshotId: string | null;
  }> {
    const resolved = this.normalizeCwd(cwd);
    const state = await this.store.load(resolved);
    const turn = state.agentTurn;
    if (!agentTurnHasFileChanges(turn)) {
      return {
        changed: false,
        snapshotId: turn?.toSnapshotId ?? null,
        baselineSnapshotId: turn?.fromSnapshotId ?? state.baselineSnapshotId,
      };
    }
    return {
      changed: true,
      snapshotId: turn.toSnapshotId,
      baselineSnapshotId: turn.fromSnapshotId,
    };
  }

  async recordAgentTurnStart(cwd: string): Promise<void> {
    const resolved = this.normalizeCwd(cwd);
    try {
      const state = await this.store.load(resolved);
      if (!state.run) return;
      const fromSnapshotId = await captureWorkingTreeSnapshot(resolved);
      await this.store.save(resolved, (mutable) => {
        if (!mutable.run) return;
        mutable.agentTurn = { fromSnapshotId, toSnapshotId: null };
      });
    } catch (error) {
      this.logger.warn({ err: error, cwd: resolved }, "Dissect agent-turn start snapshot failed");
    }
  }

  async recordAgentTurnEnd(cwd: string): Promise<void> {
    const resolved = this.normalizeCwd(cwd);
    try {
      const state = await this.store.load(resolved);
      const fromSnapshotId = state.agentTurn?.fromSnapshotId;
      if (!state.run || !fromSnapshotId) return;
      const toSnapshotId = await captureWorkingTreeSnapshot(resolved);
      await this.store.save(resolved, (mutable) => {
        if (!mutable.run || mutable.agentTurn?.fromSnapshotId !== fromSnapshotId) return;
        mutable.agentTurn = { fromSnapshotId, toSnapshotId };
      });
    } catch (error) {
      this.logger.warn({ err: error, cwd: resolved }, "Dissect agent-turn end snapshot failed");
    }
  }

  async runCodebaseDissection(
    cwd: string,
    onProgress: (event: DissectProgressEvent) => void,
  ): Promise<{ run: CodebaseDissection; baselineSnapshotId: string }> {
    const resolved = this.normalizeCwd(cwd);
    if (this.runsInFlight.has(resolved)) {
      throw new Error("A Dissect analysis is already running for this workspace.");
    }
    this.runsInFlight.add(resolved);
    try {
      const provider = this.requireCodeProvider();
      const architectureProvider = this.requireArchitectureProvider();
      const projectId = this.store.projectId(resolved);
      const knowledge = await this.knowledge.retriever(projectId, resolved);
      // Initial Dissect reads the files on disk. Git snapshots are only for
      // agent-turn Dissect Diff.
      const snapshotId = `local:${projectId}`;

      const run = await analyzeCodebase({
        cwd: resolved,
        snapshotId,
        projectId,
        provider,
        architectureProvider,
        knowledge,
        logger: this.logger,
        onProgress,
      });

      // The baseline advances only after a fully successful analysis.
      await this.store.save(resolved, (state) => {
        state.run = run;
        state.baselineSnapshotId = snapshotId;
        state.lastDiff = null;
        state.agentTurn = null;
        state.fileDissections = {};
      });
      enqueueCodebaseArchitectureCache(this.spacetime, {
        projectId,
        snapshotId,
        run,
      });
      await this.knowledge.observe({
        projectId,
        cwd: resolved,
        concepts: run.concepts.map((concept) => ({
          key: concept.key,
          explanation: concept.explanation,
        })),
        components: [
          ...run.files.map((file) => ({ path: file.path, summary: file.summary })),
          ...run.folders.map((folder) => ({ path: folder.path, summary: folder.summary })),
        ],
      });
      await this.spacetime.flush();
      onProgress({ stage: "done", detail: null, completed: null, total: null });
      return { run, baselineSnapshotId: snapshotId };
    } finally {
      this.runsInFlight.delete(resolved);
    }
  }

  async getFolder(cwd: string, runId: string, folderPath: string): Promise<FolderDissection> {
    const resolved = this.normalizeCwd(cwd);
    const state = await this.store.load(resolved);
    if (!state.run || state.run.runId !== runId) {
      throw new Error("No matching Dissect run was found. Run Dissect again.");
    }
    const folder = state.run.folders.find((entry) => entry.path === folderPath);
    if (!folder) {
      throw new Error(`Folder ${folderPath} is not part of the current dissection.`);
    }
    const files = state.run.files.filter((file) => folder.files.includes(file.path));
    const conceptByKey = new Map(state.run.concepts.map((concept) => [concept.key, concept]));
    const concepts = folder.conceptKeys
      .map((key) => conceptByKey.get(key))
      .filter((concept): concept is NonNullable<typeof concept> => Boolean(concept));
    return {
      path: folder.path,
      summary: folder.summary || `Contains ${folder.files.length} analyzed files.`,
      architectureRole: folder.role,
      files,
      concepts,
    };
  }

  async getFileDissection(cwd: string, filePath: string): Promise<FileDissection> {
    const resolved = this.normalizeCwd(cwd);
    const state = await this.store.load(resolved);
    if (!state.run) {
      throw new Error("Run Dissect on this workspace before dissecting individual files.");
    }
    const projectId = this.store.projectId(resolved);
    const retriever = await this.knowledge.retriever(projectId, resolved);
    const conceptKeys = state.run.files.find((file) => file.path === filePath)?.conceptKeys ?? [];
    const read = await readRepositoryFile(resolved, filePath, MAX_ANALYZABLE_FILE_BYTES);
    const retrieved =
      read && !read.truncated
        ? retriever.retrieve({
            conceptKeys,
            componentPaths: [filePath],
            text: read.content,
          })
        : retriever.retrieve({ conceptKeys, componentPaths: [filePath] });

    const cached = state.fileDissections[filePath];
    if (
      read &&
      !read.truncated &&
      cached?.retrievalKey === retrieved.cacheKey &&
      cached.contentHash === sha256Hex(read.content)
    ) {
      return cached.result;
    }

    const provider = this.requireCodeProvider();
    const result = await analyzeFile({
      cwd: resolved,
      path: filePath,
      provider,
      knowledge: retrieved,
    });
    await this.knowledge.observe({
      projectId,
      cwd: resolved,
      concepts: result.concepts.map((concept) => ({
        key: concept.key,
        explanation: concept.explanation,
      })),
      components: [{ path: filePath, summary: result.summary }],
    });
    await this.store.save(resolved, (mutable) => {
      mutable.fileDissections[filePath] = {
        contentHash: result.contentHash,
        retrievalKey: retrieved.cacheKey,
        result,
      };
    });
    return result;
  }

  async runDiffDissection(
    cwd: string,
    onProgress: (event: DissectProgressEvent) => void,
  ): Promise<{ diff: DiffDissection; baselineSnapshotId: string }> {
    const resolved = this.normalizeCwd(cwd);
    if (this.runsInFlight.has(resolved)) {
      throw new Error("A Dissect analysis is already running for this workspace.");
    }
    this.runsInFlight.add(resolved);
    try {
      const provider = this.requireCodeProvider();
      const state = await this.store.load(resolved);
      const snapshots = resolveAgentTurnDiffSnapshots({
        hasCodebaseRun: Boolean(state.run),
        agentTurn: state.agentTurn,
      });
      onProgress({ stage: "snapshot", detail: null, completed: null, total: null });
      const projectId = this.store.projectId(resolved);
      const knowledge = await this.knowledge.retriever(projectId, resolved);
      const priorConceptKeys = new Map(
        (state.run?.files ?? []).map((file) => [file.path, file.conceptKeys] as const),
      );
      onProgress({ stage: "diff", detail: null, completed: null, total: null });
      const diff = await analyzeDiff({
        cwd: resolved,
        fromSnapshotId: snapshots.fromSnapshotId,
        toSnapshotId: snapshots.toSnapshotId,
        provider,
        priorConceptKeys,
        knowledge,
      });
      await this.store.save(resolved, (mutable) => {
        mutable.lastDiff = diff;
        mutable.agentTurn = null;
      });
      await this.knowledge.observe({
        projectId,
        cwd: resolved,
        concepts: diff.concepts.map((concept) => ({
          key: concept.key,
          explanation: concept.explanation,
        })),
        components: [
          ...diff.changedFiles.map((file) => ({ path: file.path, summary: file.summary })),
          ...diff.changedFolders.map((folder) => ({ path: folder.path, summary: folder.summary })),
        ],
      });
      onProgress({ stage: "done", detail: null, completed: null, total: null });
      return { diff, baselineSnapshotId: snapshots.toSnapshotId };
    } finally {
      this.runsInFlight.delete(resolved);
    }
  }

  async getDiffFile(input: {
    cwd: string;
    path: string;
    fromSnapshotId: string;
    toSnapshotId: string;
  }): Promise<string> {
    const resolved = this.normalizeCwd(input.cwd);
    assertGitTreeSha(input.fromSnapshotId, "from");
    assertGitTreeSha(input.toSnapshotId, "to");
    const relativePath = input.path.replaceAll("\\", "/");
    if (
      relativePath.length === 0 ||
      relativePath.startsWith("/") ||
      relativePath.startsWith("-") ||
      relativePath.includes("\0") ||
      relativePath.split("/").includes("..")
    ) {
      throw new Error("Invalid diff path.");
    }
    return unifiedDiffBetweenSnapshots(resolved, input.fromSnapshotId, input.toSnapshotId, [
      relativePath,
    ]);
  }

  async ask(input: {
    cwd: string;
    runId: string;
    scopeKind: "folder" | "file";
    scopePath: string;
    question: string;
  }): Promise<DissectContextAnswer> {
    const resolved = this.normalizeCwd(input.cwd);
    const state = await this.store.load(resolved);
    if (!state.run || state.run.runId !== input.runId) {
      throw new Error("No matching Dissect run was found. Run Dissect again.");
    }
    const codebaseScope =
      input.scopeKind === "folder" && (input.scopePath === "." || input.scopePath === "");
    const provider = codebaseScope
      ? this.requireArchitectureProvider()
      : this.requireCodeProvider();
    const projectId = this.store.projectId(resolved);
    const knowledge = await this.knowledge.retriever(projectId, resolved);
    const answer = await answerContextQuestion({
      cwd: resolved,
      run: state.run,
      scopeKind: input.scopeKind,
      scopePath: input.scopePath,
      question: input.question,
      provider,
      knowledge,
    });
    await this.knowledge.observe({
      projectId,
      cwd: resolved,
      concepts: answer.concepts.map((concept) => ({
        key: concept.key,
        explanation: concept.explanation,
      })),
      components: [],
    });
    return answer;
  }

  async signalKnowledge(input: {
    cwd: string;
    kind: "concept" | "component";
    key: string;
    action: "know" | "explain_more";
  }): Promise<DissectKnowledgeState> {
    const resolved = this.normalizeCwd(input.cwd);
    return this.knowledge.signal({
      projectId: this.store.projectId(resolved),
      cwd: resolved,
      kind: input.kind,
      key: input.key,
      action: input.action,
    });
  }
}
