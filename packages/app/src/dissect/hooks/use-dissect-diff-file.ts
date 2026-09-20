import { useEffect, useMemo, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { parseSnapshotUnifiedDiff } from "../diff/parse-unified";
import { resolveDissectDiffGetFile } from "./fetch-dissect-diff-file";

export function useDissectDiffFile(input: {
  client: DaemonClient | null;
  cwd: string | null;
  path: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  enabled: boolean;
}): { file: ParsedDiffFile | null; error: string | null; isLoading: boolean } {
  const { client, cwd, path, fromSnapshotId, toSnapshotId, enabled } = input;
  const [file, setFile] = useState<ParsedDiffFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestKey = useMemo(
    () => `${cwd ?? ""}|${path}|${fromSnapshotId}|${toSnapshotId}`,
    [cwd, fromSnapshotId, path, toSnapshotId],
  );

  useEffect(() => {
    if (!client || !cwd || !enabled) {
      setFile(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const activeClient = client;
    const activeCwd = cwd;
    setIsLoading(true);
    setError(null);
    setFile(null);

    async function loadDiffFile(): Promise<void> {
      try {
        const payload = await resolveDissectDiffGetFile(activeClient)(activeCwd, {
          path,
          fromSnapshotId,
          toSnapshotId,
        });
        if (cancelled) return;
        if (payload.error || payload.unifiedDiff == null) {
          setError(payload.error ?? "Couldn't load this file diff.");
          setFile(null);
          return;
        }
        setFile(parseSnapshotUnifiedDiff({ path, unifiedDiff: payload.unifiedDiff }));
      } catch (caught: unknown) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setFile(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadDiffFile();
    return () => {
      cancelled = true;
    };
  }, [client, cwd, enabled, fromSnapshotId, path, requestKey, toSnapshotId]);

  return { file, error, isLoading };
}
