import type { ArchitectureGraph } from "@getpaseo/protocol/dissect";

/**
 * Serialize a validated ArchitectureGraph into Mermaid flowchart source.
 *
 * Mermaid source is always generated locally from structured data — the
 * analysis model never supplies raw Mermaid. Labels are escaped so repository
 * text cannot inject Mermaid directives.
 */

const EDGE_ARROWS: Record<string, string> = {
  imports: "-->",
  calls: "-->",
  reads: "-.->",
  writes: "-.->",
  depends_on: "-->",
  data_flow: "==>",
  contains: "---",
};

function escapeLabel(label: string): string {
  // Quoted Mermaid strings; strip characters that terminate or escape them.
  return label
    .replace(/["`\\]/g, "'")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 60);
}

function mermaidSafeToken(id: string): string | null {
  const cleaned = id.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return null;
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `n${cleaned}`;
}

function sanitizeNodeId(id: string): string | null {
  const token = mermaidSafeToken(id);
  return token ? `n_${token}` : null;
}

export function serializeArchitectureGraph(graph: ArchitectureGraph): string {
  const lines: string[] = ["flowchart TD"];
  const validIds = new Set<string>();

  for (const node of graph.nodes) {
    const id = sanitizeNodeId(node.id);
    if (!id) continue;
    validIds.add(node.id);
    const label = escapeLabel(node.path ?? node.label);
    if (node.kind === "external") {
      lines.push(`  ${id}[("${label}")]`);
    } else if (node.kind === "service") {
      lines.push(`  ${id}[["${label}"]]`);
    } else {
      lines.push(`  ${id}["${label}"]`);
    }
    lines.push(`  class ${id} dissect${node.kind === "external" ? "External" : "Internal"}`);
  }

  for (const edge of graph.edges) {
    if (!validIds.has(edge.from) || !validIds.has(edge.to)) continue;
    const from = sanitizeNodeId(edge.from);
    const to = sanitizeNodeId(edge.to);
    if (!from || !to) continue;
    const arrow = EDGE_ARROWS[edge.kind] ?? "-->";
    if (edge.label) {
      lines.push(`  ${from} ${arrow}|"${escapeLabel(edge.label)}"| ${to}`);
    } else {
      lines.push(`  ${from} ${arrow} ${to}`);
    }
  }

  lines.push("  classDef dissectInternal cursor:pointer;");
  return lines.join("\n");
}

/** Reverse the `n_` prefix applied by the serializer to recover the graph node id. */
export function graphNodeIdFromMermaidId(mermaidNodeId: string): string | null {
  // Rendered SVG ids look like `flowchart-n_auth-12`.
  const match = /(?:^|-)n_([A-Za-z0-9_]+)-\d+$/.exec(mermaidNodeId);
  return match ? match[1] : null;
}

export function findGraphNode(
  graph: ArchitectureGraph,
  mermaidNodeId: string,
): ArchitectureGraph["nodes"][number] | null {
  const token = graphNodeIdFromMermaidId(mermaidNodeId);
  if (!token) return null;
  return (
    graph.nodes.find((node) => node.id === token || mermaidSafeToken(node.id) === token) ?? null
  );
}
