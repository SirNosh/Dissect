import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  CodebaseDissection,
  DiffDissection,
  DissectKnowledgeState,
  FileDissection,
} from "@getpaseo/protocol/dissect";

/**
 * Explicit Dissect state machine, one slice per workspace key
 * (`${serverId}:${cwd}`). Phases mirror the PRD lifecycle; UI renders from
 * this state, never the other way around.
 */
export type DissectPhase =
  | "never_dissected"
  | "codebase_analyzing"
  | "codebase_ready"
  | "changes_detected"
  | "diff_analyzing"
  | "diff_ready"
  | "analysis_error";

export interface DissectProgressState {
  stage: "snapshot" | "inventory" | "file_summaries" | "architecture" | "diff" | "done";
  detail: string | null;
  completed: number | null;
  total: number | null;
}

export type DissectPaneView =
  | { kind: "architecture" }
  | { kind: "folder"; path: string }
  | { kind: "file"; path: string; lineStart?: number }
  | { kind: "diff" }
  | { kind: "diff-file"; path: string };

export interface DissectWorkspaceSlice {
  phase: DissectPhase;
  loaded: boolean;
  configured: boolean;
  configurationHint: string | null;
  run: CodebaseDissection | null;
  lastDiff: DiffDissection | null;
  knowledge: DissectKnowledgeState | null;
  progress: DissectProgressState | null;
  /** Error shown in a non-destructive banner; last successful analysis stays visible. */
  error: string | null;
  view: DissectPaneView;
  fileDissections: Record<string, FileDissection>;
  filePending: Record<string, boolean>;
}

function emptySlice(): DissectWorkspaceSlice {
  return {
    phase: "never_dissected",
    loaded: false,
    configured: false,
    configurationHint: null,
    run: null,
    lastDiff: null,
    knowledge: null,
    progress: null,
    error: null,
    view: { kind: "architecture" },
    fileDissections: {},
    filePending: {},
  };
}

function phaseAfterLoad(input: {
  run: CodebaseDissection | null;
  lastDiff: DiffDissection | null;
  changed: boolean;
}): DissectPhase {
  if (!input.run) return "never_dissected";
  if (input.changed) return "changes_detected";
  if (input.lastDiff) return "diff_ready";
  return "codebase_ready";
}

interface DissectStoreState {
  workspaces: Record<string, DissectWorkspaceSlice>;
  /** One-time acknowledgment that Dissect sends source code to the analysis model. */
  uploadConsentGiven: boolean;

  setUploadConsent(): void;
  loadState(client: DaemonClient, key: string, cwd: string): Promise<void>;
  checkChanges(client: DaemonClient, key: string, cwd: string): Promise<void>;
  startCodebase(client: DaemonClient, key: string, cwd: string): Promise<void>;
  startDiff(client: DaemonClient, key: string, cwd: string): Promise<void>;
  fetchFileDissection(client: DaemonClient, key: string, cwd: string, path: string): Promise<void>;
  signalKnowledge(
    client: DaemonClient,
    key: string,
    cwd: string,
    input: { kind: "concept" | "component"; key: string; action: "know" | "explain_more" },
  ): Promise<void>;
  setView(key: string, view: DissectPaneView): void;
  clearError(key: string): void;
}

export const useDissectStore = create<DissectStoreState>()(
  persist(
    (set, get) => {
      const updateSlice = (
        key: string,
        mutate: (slice: DissectWorkspaceSlice) => DissectWorkspaceSlice,
      ) => {
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [key]: mutate(state.workspaces[key] ?? emptySlice()),
          },
        }));
      };
      const slice = (key: string): DissectWorkspaceSlice => get().workspaces[key] ?? emptySlice();

      return {
        workspaces: {},
        uploadConsentGiven: false,

        setUploadConsent() {
          set({ uploadConsentGiven: true });
        },

        async loadState(client, key, cwd) {
          try {
            const payload = await client.dissectStateGet(cwd);
            const state = payload.state;
            if (!state) {
              updateSlice(key, (current) => ({
                ...current,
                loaded: true,
                error: payload.error,
              }));
              return;
            }
            updateSlice(key, (current) => ({
              ...current,
              loaded: true,
              configured: state.configured,
              configurationHint: state.configurationHint,
              run: state.run,
              lastDiff: state.lastDiff,
              knowledge: state.knowledge,
              phase:
                current.phase === "codebase_analyzing" || current.phase === "diff_analyzing"
                  ? current.phase
                  : phaseAfterLoad(state),
              error: null,
            }));
          } catch (error) {
            updateSlice(key, (current) => ({
              ...current,
              loaded: true,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        },

        async checkChanges(client, key, cwd) {
          const current = slice(key);
          if (
            !current.run ||
            current.phase === "codebase_analyzing" ||
            current.phase === "diff_analyzing"
          ) {
            return;
          }
          try {
            const payload = await client.dissectChangesCheck(cwd);
            if (payload.error) return;
            updateSlice(key, (existing) => {
              if (
                existing.phase === "codebase_analyzing" ||
                existing.phase === "diff_analyzing" ||
                !existing.run
              ) {
                return existing;
              }
              let phase: DissectPhase = "codebase_ready";
              if (payload.changed) phase = "changes_detected";
              else if (existing.lastDiff) phase = "diff_ready";
              return { ...existing, phase };
            });
          } catch {
            // Change detection is advisory; ignore transient failures.
          }
        },

        async startCodebase(client, key, cwd) {
          updateSlice(key, (current) => ({
            ...current,
            phase: "codebase_analyzing",
            progress: { stage: "inventory", detail: null, completed: null, total: null },
            error: null,
          }));
          try {
            const payload = await client.dissectCodebaseStart(cwd, (progress) => {
              updateSlice(key, (current) => ({
                ...current,
                progress: {
                  stage: progress.stage,
                  detail: progress.detail,
                  completed: progress.completed,
                  total: progress.total,
                },
              }));
            });
            if (!payload.run) {
              throw new Error(payload.error ?? "Dissect analysis failed.");
            }
            updateSlice(key, (current) => ({
              ...current,
              phase: "codebase_ready",
              run: payload.run,
              lastDiff: null,
              progress: null,
              error: null,
              view: { kind: "architecture" },
              fileDissections: {},
              filePending: {},
            }));
          } catch (error) {
            updateSlice(key, (current) => ({
              ...current,
              // Preserve the previous successful analysis; only surface the error.
              phase: current.run ? "analysis_error" : "never_dissected",
              progress: null,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        },

        async startDiff(client, key, cwd) {
          updateSlice(key, (current) => ({
            ...current,
            phase: "diff_analyzing",
            progress: { stage: "snapshot", detail: null, completed: null, total: null },
            error: null,
          }));
          try {
            const payload = await client.dissectDiffStart(cwd, (progress) => {
              updateSlice(key, (current) => ({
                ...current,
                progress: {
                  stage: progress.stage,
                  detail: progress.detail,
                  completed: progress.completed,
                  total: progress.total,
                },
              }));
            });
            if (!payload.diff) {
              throw new Error(payload.error ?? "Dissect Diff analysis failed.");
            }
            updateSlice(key, (current) => ({
              ...current,
              phase: "diff_ready",
              lastDiff: payload.diff,
              progress: null,
              error: null,
              view: { kind: "diff" },
            }));
          } catch (error) {
            updateSlice(key, (current) => ({
              ...current,
              phase: current.run ? "changes_detected" : "never_dissected",
              progress: null,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        },

        async fetchFileDissection(client, key, cwd, path) {
          const current = slice(key);
          if (!current.run || current.fileDissections[path] || current.filePending[path]) {
            return;
          }
          updateSlice(key, (existing) => ({
            ...existing,
            filePending: { ...existing.filePending, [path]: true },
          }));
          try {
            const payload = await client.dissectFileGet(cwd, path);
            updateSlice(key, (existing) => ({
              ...existing,
              filePending: { ...existing.filePending, [path]: false },
              fileDissections: payload.file
                ? { ...existing.fileDissections, [path]: payload.file }
                : existing.fileDissections,
            }));
          } catch {
            updateSlice(key, (existing) => ({
              ...existing,
              filePending: { ...existing.filePending, [path]: false },
            }));
          }
        },

        async signalKnowledge(client, key, cwd, input) {
          try {
            const payload = await client.dissectKnowledgeSignal(cwd, input);
            if (payload.knowledge) {
              updateSlice(key, (existing) => ({
                ...existing,
                knowledge: payload.knowledge,
              }));
            }
          } catch {
            // Knowledge persistence failures never interrupt the reading flow.
          }
        },

        setView(key, view) {
          updateSlice(key, (current) => ({ ...current, view }));
        },

        clearError(key) {
          updateSlice(key, (current) => ({ ...current, error: null }));
        },
      };
    },
    {
      name: "dissect-consent",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ uploadConsentGiven: state.uploadConsentGiven }),
    },
  ),
);

export function selectDissectSlice(
  state: Pick<DissectStoreState, "workspaces">,
  key: string,
): DissectWorkspaceSlice {
  return state.workspaces[key] ?? EMPTY_SLICE;
}

const EMPTY_SLICE = emptySlice();
