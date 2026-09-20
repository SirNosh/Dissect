import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

/**
 * The host-runtime store keeps DaemonClient instances across Metro reloads.
 * A connection created before `dissectDiffGetFile` existed will not have that
 * method on its prototype even though Dissect Diff overview RPCs still work.
 * Bind the current class method onto that live instance instead of throwing.
 */
export function resolveDissectDiffGetFile(
  client: DaemonClient,
): DaemonClient["dissectDiffGetFile"] {
  const fromInstance = (client as { dissectDiffGetFile?: unknown }).dissectDiffGetFile;
  if (typeof fromInstance === "function") {
    return (fromInstance as DaemonClient["dissectDiffGetFile"]).bind(client);
  }
  const fromClass = DaemonClient.prototype.dissectDiffGetFile;
  if (typeof fromClass === "function") {
    return fromClass.bind(client);
  }
  throw new Error("Couldn't load this file diff. Reload the app to refresh the host connection.");
}
