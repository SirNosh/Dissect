import { useCallback, useMemo } from "react";
import type { DiffBlockDissection } from "@getpaseo/protocol/dissect";
import { selectDissectSlice, useDissectStore } from "../state/dissect-store";

/**
 * Change-block annotations from the last successful Dissect Diff.
 * Empty until the user explicitly runs Dissect Diff — never inferred from
 * checkout status or the coding-agent transcript.
 */
export function useDissectDiffBlocks(input: {
  serverId: string;
  cwd: string | null;
}): ReadonlyMap<string, DiffBlockDissection[]> {
  const workspaceKey = input.cwd ? `${input.serverId}:${input.cwd}` : "";
  const lastDiff = useDissectStore(
    useCallback((state) => selectDissectSlice(state, workspaceKey).lastDiff, [workspaceKey]),
  );

  return useMemo(() => {
    const blocksByPath = new Map<string, DiffBlockDissection[]>();
    if (!lastDiff) return blocksByPath;
    for (const file of lastDiff.changedFiles) {
      if (file.blocks.length > 0) blocksByPath.set(file.path, file.blocks);
    }
    return blocksByPath;
  }, [lastDiff]);
}
