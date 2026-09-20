import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DissectContextAnswer } from "@getpaseo/protocol/dissect";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import {
  selectDissectSlice,
  useDissectStore,
  type DissectPaneView,
  type DissectWorkspaceSlice,
} from "../state/dissect-store";

export interface DissectWorkspaceHandle {
  slice: DissectWorkspaceSlice;
  client: DaemonClient | null;
  cwd: string | null;
  workspaceKey: string | null;
  /** True while a coding agent in this workspace is actively running. */
  agentBusy: boolean;
  uploadConsentGiven: boolean;
  setUploadConsent: () => void;
  startCodebase: () => void;
  startDiff: () => void;
  setView: (view: DissectPaneView) => void;
  clearError: () => void;
  signalKnowledge: (input: {
    kind: "concept" | "component";
    key: string;
    action: "know" | "explain_more";
  }) => void;
  ask: (input: {
    scope: { kind: "folder" | "file"; path: string };
    question: string;
  }) => Promise<DissectContextAnswer>;
}

const CHANGE_CHECK_DEBOUNCE_MS = 2000;

/**
 * Orchestration for the Dissect pane. Loads persisted state on mount and runs
 * cheap local change detection when the checkout status changes. Never issues
 * an LLM-backed request without an explicit user action.
 */
export function useDissectWorkspace(input: {
  serverId: string;
  workspaceId: string;
}): DissectWorkspaceHandle {
  const { serverId, workspaceId } = input;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const workspaceKey = cwd ? `${serverId}:${cwd}` : null;

  const slice = useDissectStore(
    useCallback((state) => selectDissectSlice(state, workspaceKey ?? ""), [workspaceKey]),
  );
  const uploadConsentGiven = useDissectStore((state) => state.uploadConsentGiven);

  const agentBusy = useSessionStore(
    useCallback(
      (state) => {
        const agents = state.sessions[serverId]?.agents;
        if (!agents) return false;
        for (const agent of agents.values()) {
          if (agent.workspaceId === workspaceId && agent.status === "running") {
            return true;
          }
        }
        return false;
      },
      [serverId, workspaceId],
    ),
  );

  // Restore persisted analysis state once per workspace connection.
  const loadedForKey = useRef<string | null>(null);
  useEffect(() => {
    if (!client || !isConnected || !cwd || !workspaceKey) return;
    if (loadedForKey.current === workspaceKey) return;
    loadedForKey.current = workspaceKey;
    void useDissectStore.getState().loadState(client, workspaceKey, cwd);
  }, [client, isConnected, cwd, workspaceKey]);

  // Re-evaluate Dissect Diff when checkout status changes or a coding agent
  // finishes a turn. The daemon records turn snapshots asynchronously.
  const statusQuery = useCheckoutStatusQuery({ serverId, cwd: cwd ?? "" });
  const checkoutStatus = statusQuery.status;
  const statusFingerprint = useMemo(
    () => (checkoutStatus ? JSON.stringify(checkoutStatus) : null),
    [checkoutStatus],
  );
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRun = slice.run !== null;
  useEffect(() => {
    if (!client || !cwd || !workspaceKey || !hasRun) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void useDissectStore.getState().checkChanges(client, workspaceKey, cwd);
    }, CHANGE_CHECK_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [client, cwd, workspaceKey, hasRun, statusFingerprint, agentBusy]);

  const startCodebase = useCallback(() => {
    if (!client || !cwd || !workspaceKey) return;
    void useDissectStore.getState().startCodebase(client, workspaceKey, cwd);
  }, [client, cwd, workspaceKey]);

  const startDiff = useCallback(() => {
    if (!client || !cwd || !workspaceKey) return;
    void useDissectStore.getState().startDiff(client, workspaceKey, cwd);
  }, [client, cwd, workspaceKey]);

  const setView = useCallback(
    (view: DissectPaneView) => {
      if (!workspaceKey) return;
      useDissectStore.getState().setView(workspaceKey, view);
    },
    [workspaceKey],
  );

  const clearError = useCallback(() => {
    if (!workspaceKey) return;
    useDissectStore.getState().clearError(workspaceKey);
  }, [workspaceKey]);

  const signalKnowledge = useCallback(
    (signal: { kind: "concept" | "component"; key: string; action: "know" | "explain_more" }) => {
      if (!client || !cwd || !workspaceKey) return;
      void useDissectStore.getState().signalKnowledge(client, workspaceKey, cwd, signal);
    },
    [client, cwd, workspaceKey],
  );

  const ask = useCallback(
    async (askInput: {
      scope: { kind: "folder" | "file"; path: string };
      question: string;
    }): Promise<DissectContextAnswer> => {
      if (!client || !cwd) {
        throw new Error("Dissect is not connected.");
      }
      const runId = useDissectStore.getState().workspaces[workspaceKey ?? ""]?.run?.runId;
      if (!runId) {
        throw new Error("Dissect this workspace first.");
      }
      const payload = await client.dissectChatAsk(cwd, {
        runId,
        scope: askInput.scope,
        question: askInput.question,
      });
      if (!payload.answer) {
        throw new Error(payload.error ?? "Dissect could not answer the question.");
      }
      return payload.answer;
    },
    [client, cwd, workspaceKey],
  );

  const setUploadConsent = useCallback(() => {
    useDissectStore.getState().setUploadConsent();
  }, []);

  return useMemo(
    () => ({
      slice,
      client,
      cwd,
      workspaceKey,
      agentBusy,
      uploadConsentGiven,
      setUploadConsent,
      startCodebase,
      startDiff,
      setView,
      clearError,
      signalKnowledge,
      ask,
    }),
    [
      slice,
      client,
      cwd,
      workspaceKey,
      agentBusy,
      uploadConsentGiven,
      setUploadConsent,
      startCodebase,
      startDiff,
      setView,
      clearError,
      signalKnowledge,
      ask,
    ],
  );
}
