import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ArchitectureGraph } from "@getpaseo/protocol/dissect";
import { findGraphNode, serializeArchitectureGraph } from "../map/mermaid-serializer";

let renderRevision = 0;

/**
 * Interactive Mermaid architecture map.
 *
 * Mermaid source is generated locally from the validated graph structure and
 * rendered with `securityLevel: "strict"` and no HTML labels, so no
 * LLM-provided JavaScript can ever execute. Click handlers are attached after
 * rendering using structured node ids only.
 */
export function ArchitectureMap({
  graph,
  onSelectNode,
}: {
  graph: ArchitectureGraph;
  onSelectNode: (nodeId: string, path: string | null) => void;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const colorScheme = UnistylesRuntime.getTheme().colorScheme;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: colorScheme === "dark" ? "dark" : "neutral",
          flowchart: { htmlLabels: false },
        });
        const source = serializeArchitectureGraph(graph);
        const revision = ++renderRevision;
        const { svg: rendered } = await mermaid.render(`dissect-map-${revision}`, source);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graph, colorScheme]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !svg) return;
    host.innerHTML = svg;
    const svgElement = host.querySelector("svg");
    if (svgElement) {
      svgElement.style.maxWidth = "100%";
      svgElement.style.height = "auto";
    }
    for (const element of host.querySelectorAll("g.node")) {
      const node = findGraphNode(graph, element.id);
      if (!node || node.kind === "external") continue;
      (element as HTMLElement).style.cursor = "pointer";
      element.setAttribute("data-dissect-node", node.id);
    }
    const handleClick = (event: Event) => {
      let target = event.target as Element | null;
      while (target && target !== host) {
        const nodeId = target.getAttribute?.("data-dissect-node");
        if (nodeId) {
          const node = graph.nodes.find((candidate) => candidate.id === nodeId);
          onSelectNode(nodeId, node?.path ?? null);
          return;
        }
        target = target.parentElement;
      }
    };
    host.addEventListener("click", handleClick);
    return () => {
      host.removeEventListener("click", handleClick);
    };
  }, [svg, graph, onSelectNode]);

  if (failed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{t("dissect.map.renderFailed")}</Text>
      </View>
    );
  }

  return <div ref={hostRef} data-testid="dissect-architecture-map" style={MAP_HOST_STYLE} />;
}

const MAP_HOST_STYLE = { width: "100%", overflow: "auto" } as const;

const styles = StyleSheet.create((theme) => ({
  fallback: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  fallbackText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
