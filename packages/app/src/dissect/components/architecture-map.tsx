import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ArchitectureGraph, ArchitectureNode } from "@getpaseo/protocol/dissect";

/**
 * Native fallback for the architecture map: a pressable node list. The
 * interactive Mermaid rendering lives in the `.web` variant.
 */
export function ArchitectureMap({
  graph,
  onSelectNode,
}: {
  graph: ArchitectureGraph;
  onSelectNode: (nodeId: string, path: string | null) => void;
}) {
  return (
    <View style={styles.list} testID="dissect-architecture-map">
      {graph.nodes.map((node) => (
        <ArchitectureNodeRow key={node.id} node={node} onSelectNode={onSelectNode} />
      ))}
    </View>
  );
}

function ArchitectureNodeRow({
  node,
  onSelectNode,
}: {
  node: ArchitectureNode;
  onSelectNode: (nodeId: string, path: string | null) => void;
}) {
  const handlePress = useCallback(() => onSelectNode(node.id, node.path), [node, onSelectNode]);
  return (
    <Pressable style={styles.row} disabled={node.kind === "external"} onPress={handlePress}>
      <Text style={styles.label}>{node.path ?? node.label}</Text>
      <Text style={styles.summary} numberOfLines={2}>
        {node.summary}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[2],
  },
  row: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
