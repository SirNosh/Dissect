import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DiffChangedFile, DiffDissection } from "@getpaseo/protocol/dissect";
import { ConceptActions } from "../components/concept-actions";
import type { DissectWorkspaceHandle } from "../hooks/use-dissect-workspace";

/**
 * Dissect Diff overview: summary, changed folder/file hierarchy, architecture
 * impact, and per-file change-block explanations. Clicking a changed file
 * opens that file's snapshot diff in this pane.
 */
export function DissectDiffView({
  diff,
  handle,
  onOpenDiffFile,
  onBack,
}: {
  diff: DiffDissection;
  handle: DissectWorkspaceHandle;
  onOpenDiffFile: (path: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const knownConceptKeys = Object.entries(handle.slice.knowledge?.concepts ?? {})
    .filter(([, familiarity]) => familiarity === "comfortable")
    .map(([key]) => key);
  const blocksByPath = new Map(diff.changedFiles.map((file) => [file.path, file]));
  const onKnow = useCallback(
    (key: string) => {
      handle.signalKnowledge({ kind: "concept", key, action: "know" });
    },
    [handle],
  );

  return (
    <View style={styles.container} testID="dissect-diff-view">
      <Pressable onPress={onBack} testID="dissect-diff-back">
        <Text style={styles.backLink}>{t("dissect.diff.backToArchitecture")}</Text>
      </Pressable>

      <Text style={styles.heading}>{t("dissect.diff.whatChanged")}</Text>
      <Text style={styles.summary}>{diff.summary}</Text>

      <Text style={styles.sectionHeading}>{t("dissect.diff.changedAreas")}</Text>
      <View style={styles.folderList}>
        {diff.changedFolders.map((folder) => (
          <View key={folder.path} style={styles.folderBlock}>
            <Text style={styles.folderPath}>{folder.path === "." ? "/" : `/${folder.path}`}</Text>
            {folder.summary ? <Text style={styles.folderSummary}>{folder.summary}</Text> : null}
            {folder.files.map((filePath) => (
              <ChangedFileRow
                key={filePath}
                filePath={filePath}
                changedFile={blocksByPath.get(filePath) ?? null}
                isExpanded={expandedFile === filePath}
                onOpenDiffFile={onOpenDiffFile}
                onToggleExpanded={setExpandedFile}
              />
            ))}
          </View>
        ))}
      </View>

      {diff.architectureImpact.length > 0 ? (
        <View>
          <Text style={styles.sectionHeading}>{t("dissect.diff.architectureImpact")}</Text>
          {diff.architectureImpact.map((impact) => (
            <Text key={impact} style={styles.impactText}>
              • {impact}
            </Text>
          ))}
        </View>
      ) : null}

      {diff.concepts.length > 0 ? (
        <ConceptActions
          concepts={diff.concepts}
          knownConceptKeys={knownConceptKeys}
          onKnow={onKnow}
        />
      ) : null}
    </View>
  );
}

function ChangedFileRow({
  filePath,
  changedFile,
  isExpanded,
  onOpenDiffFile,
  onToggleExpanded,
}: {
  filePath: string;
  changedFile: DiffChangedFile | null;
  isExpanded: boolean;
  onOpenDiffFile: (path: string) => void;
  onToggleExpanded: (path: string | null) => void;
}) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => onOpenDiffFile(filePath), [filePath, onOpenDiffFile]);
  const handleToggle = useCallback(() => {
    onToggleExpanded(isExpanded ? null : filePath);
  }, [filePath, isExpanded, onToggleExpanded]);
  const statusLabel = changedFile ? t(`dissect.diff.status.${changedFile.status}`) : "";
  const fileLabel = `${filePath.split("/").pop()}${statusLabel ? ` · ${statusLabel}` : ""}`;

  return (
    <View>
      <View style={styles.fileRow}>
        <Pressable
          style={styles.fileNameButton}
          onPress={handleOpen}
          testID={`dissect-diff-file-${filePath}`}
        >
          <Text style={styles.fileName}>{fileLabel}</Text>
        </Pressable>
        {changedFile && changedFile.blocks.length > 0 ? (
          <Pressable onPress={handleToggle} testID={`dissect-diff-blocks-${filePath}`}>
            <Text style={styles.blockToggle}>
              {isExpanded
                ? t("dissect.diff.hideBlocks")
                : t("dissect.diff.showBlocks", { count: changedFile.blocks.length })}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {changedFile?.summary ? <Text style={styles.fileSummary}>{changedFile.summary}</Text> : null}
      {isExpanded && changedFile
        ? changedFile.blocks.map((block) => {
            const lineLabel = block.newStartLine
              ? `  (${t("dissect.diff.lines")} ${block.newStartLine}–${block.newEndLine ?? block.newStartLine})`
              : "";
            return (
              <View key={block.id} style={styles.blockCard}>
                <Text style={styles.blockTitle}>
                  {block.title}
                  {lineLabel}
                </Text>
                <Text style={styles.blockText}>{block.summary}</Text>
                <Text style={styles.blockLabel}>{t("dissect.diff.whyItChanged")}</Text>
                <Text style={styles.blockText}>{block.whyItChanged}</Text>
                <Text style={styles.blockLabel}>{t("dissect.diff.effect")}</Text>
                <Text style={styles.blockText}>{block.effect}</Text>
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  backLink: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  heading: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
  },
  summary: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  sectionHeading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: theme.spacing[2],
  },
  folderList: {
    gap: theme.spacing[3],
  },
  folderBlock: {
    gap: theme.spacing[1],
  },
  folderPath: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    fontFamily: theme.fontFamily.mono,
  },
  folderSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginLeft: theme.spacing[3],
  },
  fileNameButton: {
    flexShrink: 1,
  },
  fileName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    textDecorationLine: "underline",
  },
  fileSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: theme.spacing[3],
  },
  blockToggle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  blockCard: {
    marginLeft: theme.spacing[3],
    marginTop: theme.spacing[1],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  blockTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  blockLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  blockText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  impactText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
}));
