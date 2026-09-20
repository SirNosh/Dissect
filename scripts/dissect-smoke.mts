/**
 * One-shot Dissect smoke test.
 *
 * Connects to a locally started daemon and verifies the Dissect RPC surface
 * end to end: feature flag advertisement, state retrieval for a real cwd, and
 * the change-detection endpoint. Does not call any LLM.
 *
 * Usage: npx tsx scripts/dissect-smoke.mts <daemonHome> <cwd>
 */
import { connectToDaemon } from "../packages/cli/src/utils/client.js";

const [home, cwd] = process.argv.slice(2);
if (!home || !cwd) {
  console.error("usage: dissect-smoke.mts <daemonHome> <cwd>");
  process.exit(2);
}

const client = await connectToDaemon({ target: { kind: "instance", home } });
try {
  const serverInfo = client.getLastServerInfoMessage();
  console.log("features.dissect =", serverInfo?.features?.dissect);
  if (serverInfo?.features?.dissect !== true) {
    throw new Error("daemon does not advertise the dissect feature");
  }

  const statePayload = await client.dissectStateGet(cwd);
  if (statePayload.error || !statePayload.state) {
    throw new Error(`dissect.state.get failed: ${statePayload.error ?? "no state"}`);
  }
  console.log("dissect.state.get =>", {
    configured: statePayload.state.configured,
    configurationHint: statePayload.state.configurationHint,
    hasRun: statePayload.state.run !== null,
    changed: statePayload.state.changed,
    knownConcepts: statePayload.state.knowledge.concepts.length,
  });

  const changes = await client.dissectChangesCheck(cwd);
  console.log("dissect.changes.check =>", changes);

  console.log("SMOKE OK");
} finally {
  await client.close();
}
process.exit(0);
