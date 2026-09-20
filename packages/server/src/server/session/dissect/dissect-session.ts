import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { DissectService } from "../../../dissect/index.js";

export interface DissectSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface DissectSessionOptions {
  host: DissectSessionHost;
  service: DissectService;
  logger: pino.Logger;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Session-level RPC handlers for the Dissect domain. Handlers only translate
 * between wire messages and the daemon-global DissectService; no analysis
 * logic lives here and no agent state is reachable from here.
 */
export class DissectSession {
  private readonly host: DissectSessionHost;
  private readonly service: DissectService;
  private readonly logger: pino.Logger;

  constructor(options: DissectSessionOptions) {
    this.host = options.host;
    this.service = options.service;
    this.logger = options.logger;
  }

  private emitProgress(requestId: string) {
    return (event: {
      stage: "snapshot" | "inventory" | "file_summaries" | "architecture" | "diff" | "done";
      detail: string | null;
      completed: number | null;
      total: number | null;
    }) => {
      this.host.emit({
        type: "dissect.progress",
        payload: { requestId, ...event },
      });
    };
  }

  async handleStateGet(
    request: Extract<SessionInboundMessage, { type: "dissect.state.get.request" }>,
  ): Promise<void> {
    try {
      const state = await this.service.getState(request.cwd);
      this.host.emit({
        type: "dissect.state.get.response",
        payload: { requestId: request.requestId, state, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Dissect state request failed");
      this.host.emit({
        type: "dissect.state.get.response",
        payload: { requestId: request.requestId, state: null, error: errorMessage(error) },
      });
    }
  }

  async handleCodebaseStart(
    request: Extract<SessionInboundMessage, { type: "dissect.codebase.start.request" }>,
  ): Promise<void> {
    try {
      const { run, baselineSnapshotId } = await this.service.runCodebaseDissection(
        request.cwd,
        this.emitProgress(request.requestId),
      );
      this.host.emit({
        type: "dissect.codebase.start.response",
        payload: { requestId: request.requestId, run, baselineSnapshotId, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Dissect codebase analysis failed");
      this.host.emit({
        type: "dissect.codebase.start.response",
        payload: {
          requestId: request.requestId,
          run: null,
          baselineSnapshotId: null,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleFolderGet(
    request: Extract<SessionInboundMessage, { type: "dissect.folder.get.request" }>,
  ): Promise<void> {
    try {
      const folder = await this.service.getFolder(request.cwd, request.runId, request.path);
      this.host.emit({
        type: "dissect.folder.get.response",
        payload: { requestId: request.requestId, folder, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "dissect.folder.get.response",
        payload: { requestId: request.requestId, folder: null, error: errorMessage(error) },
      });
    }
  }

  async handleFileGet(
    request: Extract<SessionInboundMessage, { type: "dissect.file.get.request" }>,
  ): Promise<void> {
    try {
      const file = await this.service.getFileDissection(request.cwd, request.path);
      this.host.emit({
        type: "dissect.file.get.response",
        payload: { requestId: request.requestId, file, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error, path: request.path }, "Dissect file analysis failed");
      this.host.emit({
        type: "dissect.file.get.response",
        payload: { requestId: request.requestId, file: null, error: errorMessage(error) },
      });
    }
  }

  async handleDiffStart(
    request: Extract<SessionInboundMessage, { type: "dissect.diff.start.request" }>,
  ): Promise<void> {
    try {
      const { diff, baselineSnapshotId } = await this.service.runDiffDissection(
        request.cwd,
        this.emitProgress(request.requestId),
      );
      this.host.emit({
        type: "dissect.diff.start.response",
        payload: { requestId: request.requestId, diff, baselineSnapshotId, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Dissect diff analysis failed");
      this.host.emit({
        type: "dissect.diff.start.response",
        payload: {
          requestId: request.requestId,
          diff: null,
          baselineSnapshotId: null,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleDiffGetFile(
    request: Extract<SessionInboundMessage, { type: "dissect.diff.get_file.request" }>,
  ): Promise<void> {
    try {
      const unifiedDiff = await this.service.getDiffFile({
        cwd: request.cwd,
        path: request.path,
        fromSnapshotId: request.fromSnapshotId,
        toSnapshotId: request.toSnapshotId,
      });
      this.host.emit({
        type: "dissect.diff.get_file.response",
        payload: { requestId: request.requestId, unifiedDiff, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "dissect.diff.get_file.response",
        payload: {
          requestId: request.requestId,
          unifiedDiff: null,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleChangesCheck(
    request: Extract<SessionInboundMessage, { type: "dissect.changes.check.request" }>,
  ): Promise<void> {
    try {
      const result = await this.service.checkChanges(request.cwd);
      this.host.emit({
        type: "dissect.changes.check.response",
        payload: { requestId: request.requestId, ...result, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "dissect.changes.check.response",
        payload: {
          requestId: request.requestId,
          changed: false,
          snapshotId: null,
          baselineSnapshotId: null,
          error: errorMessage(error),
        },
      });
    }
  }

  async handleChatAsk(
    request: Extract<SessionInboundMessage, { type: "dissect.chat.ask.request" }>,
  ): Promise<void> {
    try {
      const answer = await this.service.ask({
        cwd: request.cwd,
        runId: request.runId,
        scopeKind: request.scope.kind,
        scopePath: request.scope.path,
        question: request.question,
      });
      this.host.emit({
        type: "dissect.chat.ask.response",
        payload: { requestId: request.requestId, answer, error: null },
      });
    } catch (error) {
      this.logger.warn({ err: error }, "Dissect chat request failed");
      this.host.emit({
        type: "dissect.chat.ask.response",
        payload: { requestId: request.requestId, answer: null, error: errorMessage(error) },
      });
    }
  }

  async handleKnowledgeSignal(
    request: Extract<SessionInboundMessage, { type: "dissect.knowledge.signal.request" }>,
  ): Promise<void> {
    try {
      const knowledge = await this.service.signalKnowledge({
        cwd: request.cwd,
        kind: request.target.kind,
        key: request.target.key,
        action: request.action,
      });
      this.host.emit({
        type: "dissect.knowledge.signal.response",
        payload: { requestId: request.requestId, knowledge, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "dissect.knowledge.signal.response",
        payload: { requestId: request.requestId, knowledge: null, error: errorMessage(error) },
      });
    }
  }
}
