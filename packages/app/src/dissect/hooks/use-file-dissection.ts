import { useCallback, useEffect, useMemo } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { selectDissectSlice, useDissectStore } from "../state/dissect-store";
import type { DissectFileAnnotations } from "../types";

const EMPTY_ANNOTATIONS: DissectFileAnnotations = {
  status: "idle",
  blocks: [],
  concepts: [],
  knownConceptKeys: [],
  onConceptAction: null,
};

/**
 * Lazy per-file Dissect annotations for the source viewer. A file dissection
 * request fires only when the workspace already has a successful Dissect run;
 * the file itself always renders immediately.
 */
export function useDissectFileAnnotations(input: {
  serverId: string;
  client: DaemonClient | null;
  cwd: string | null;
  path: string | null;
  enabled: boolean;
}): DissectFileAnnotations {
  const { serverId, client, cwd, path, enabled } = input;
  const workspaceKey = cwd ? `${serverId}:${cwd}` : null;

  const slice = useDissectStore(
    useCallback((state) => selectDissectSlice(state, workspaceKey ?? ""), [workspaceKey]),
  );

  const runId = slice.run?.runId ?? null;
  const dissection = path ? (slice.fileDissections[path] ?? null) : null;
  const pending = path ? slice.filePending[path] === true : false;

  useEffect(() => {
    if (!client || !cwd || !path || !workspaceKey || !enabled || !runId) return;
    if (dissection || pending) return;
    void useDissectStore.getState().fetchFileDissection(client, workspaceKey, cwd, path);
  }, [client, cwd, path, workspaceKey, enabled, runId, dissection, pending]);

  const knowledge = slice.knowledge;
  const onConceptAction = useCallback(
    (conceptKey: string, action: "know" | "explain_more") => {
      if (!client || !cwd || !workspaceKey) return;
      void useDissectStore
        .getState()
        .signalKnowledge(client, workspaceKey, cwd, { kind: "concept", key: conceptKey, action });
    },
    [client, cwd, workspaceKey],
  );

  return useMemo(() => {
    if (!runId || !path || !enabled) return EMPTY_ANNOTATIONS;
    if (dissection) {
      return {
        status: "ready",
        blocks: dissection.blocks,
        concepts: dissection.concepts,
        knownConceptKeys: Object.entries(knowledge?.concepts ?? {})
          .filter(([, familiarity]) => familiarity === "comfortable")
          .map(([key]) => key),
        onConceptAction,
      };
    }
    return { ...EMPTY_ANNOTATIONS, status: pending ? "analyzing" : "idle" };
  }, [runId, path, enabled, dissection, pending, knowledge, onConceptAction]);
}
