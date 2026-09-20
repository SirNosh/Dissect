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
import { resolveDissectProviderConfig, type DissectTextProvider } from "./providers/provider.js";
import { captureWorkingTreeSnapshot, assertGitTreeSha } from "./snapshot/git-tree-snapshot.js";
import { unifiedDiffBetweenSnapshots } from "./snapshot/diff-between-snapshots.js";
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

  private resolveProvider(): {
    provider: DissectTextProvider | null;
    hint: string | null;
  } {
    const { config, hint } = resolveDissectProviderConfig(
      overlayDissectLlmEnvFromCheckout(process.env),
    );
    return { provider: config ? new OpenAICompatibleProvider(config) : null, hint };
  }

  private requireProvider(): DissectTextProvider {
    if (this.analysisProvider) return this.analysisProvider;
    const { provider, hint } = this.resolveProvider();
    if (!provider) {
      throw new Error(hint ?? "Dissect needs an analysis model.");
    }
    return provider;
  }

  private normalizeCwd(cwd: string): string {
    return expandTilde(cwd);
  }

  async getState(cwd: string): Promise<DissectWorkspaceState> {
    const resolved = this.normalizeCwd(cwd);
    const state = await this.store.load(resolved);
    const { provider, hint } = this.resolveProvider();
    const knowledge = await this.knowledge.getState(this.store.projectId(resolved), resolved);
    return {
      configured: provider !== null,
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
      const provider = this.requireProvider();
      const projectId = this.store.projectId(resolved);
      const knowledge = await this.knowledge.getState(projectId, resolved);
      // Initial Dissect reads the files on disk. Git snapshots are only for
      // agent-turn Dissect Diff.
      const snapshotId = `local:${projectId}`;

      const run = await analyzeCodebase({
        cwd: resolved,
        snapshotId,
        projectId,
        provider,
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
    const knowledge = await this.knowledge.getState(projectId, resolved);

    const cached = state.fileDissections[filePath];
    if (cached && cached.knowledgeRevision === knowledge.revision) {
      // Content-addressed: reuse only when the current file still matches.
      const { readRepositoryFile } = await import("./repository/inventory.js");
      const { sha256Hex } = await import("./repository/hash.js");
      const read = await readRepositoryFile(resolved, filePath, 1024 * 1024);
      if (read && sha256Hex(read.content) === cached.contentHash) {
        return cached.result;
      }
    }

    const provider = this.requireProvider();
    const result = await analyzeFile({ cwd: resolved, path: filePath, provider, knowledge });
    await this.store.save(resolved, (mutable) => {
      mutable.fileDissections[filePath] = {
        contentHash: result.contentHash,
        knowledgeRevision: knowledge.revision,
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
      const provider = this.requireProvider();
      const state = await this.store.load(resolved);
      const snapshots = resolveAgentTurnDiffSnapshots({
        hasCodebaseRun: Boolean(state.run),
        agentTurn: state.agentTurn,
      });
      onProgress({ stage: "snapshot", detail: null, completed: null, total: null });
      const projectId = this.store.projectId(resolved);
      const knowledge = await this.knowledge.getState(projectId, resolved);
      onProgress({ stage: "diff", detail: null, completed: null, total: null });
      const diff = await analyzeDiff({
        cwd: resolved,
        fromSnapshotId: snapshots.fromSnapshotId,
        toSnapshotId: snapshots.toSnapshotId,
        provider,
        knowledge,
      });
      await this.store.save(resolved, (mutable) => {
        mutable.lastDiff = diff;
        mutable.agentTurn = null;
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
    const provider = this.requireProvider();
    const knowledge = await this.knowledge.getState(this.store.projectId(resolved), resolved);
    return answerContextQuestion({
      cwd: resolved,
      run: state.run,
      scopeKind: input.scopeKind,
      scopePath: input.scopePath,
      question: input.question,
      provider,
      knowledge,
    });
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
