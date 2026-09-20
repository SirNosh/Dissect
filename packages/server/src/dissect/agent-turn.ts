export interface DissectAgentTurnSnapshots {
  fromSnapshotId: string;
  toSnapshotId: string | null;
}

export function agentTurnHasFileChanges(
  turn: DissectAgentTurnSnapshots | null | undefined,
): turn is { fromSnapshotId: string; toSnapshotId: string } {
  return Boolean(
    turn?.fromSnapshotId && turn.toSnapshotId && turn.fromSnapshotId !== turn.toSnapshotId,
  );
}

/**
 * The next Dissect Diff compares the latest completed agent turn's snapshots,
 * not the whole working tree since the last full Dissect.
 */
export function resolveAgentTurnDiffSnapshots(input: {
  hasCodebaseRun: boolean;
  agentTurn: DissectAgentTurnSnapshots | null | undefined;
}): { fromSnapshotId: string; toSnapshotId: string } {
  if (!input.hasCodebaseRun) {
    throw new Error("There is no Dissect baseline yet. Run a full Dissect first.");
  }
  const turn = input.agentTurn;
  if (!turn?.fromSnapshotId || !turn.toSnapshotId) {
    throw new Error("No agent-turn file changes to dissect. Run an agent turn first.");
  }
  if (turn.fromSnapshotId === turn.toSnapshotId) {
    throw new Error("The latest agent turn did not change any files.");
  }
  return { fromSnapshotId: turn.fromSnapshotId, toSnapshotId: turn.toSnapshotId };
}
