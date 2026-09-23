import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DiffChangedFile, DiffDissection } from "@getpaseo/protocol/dissect";
import { ConceptActions } from "../components/concept-actions";
import type { DissectWorkspaceHandle } from "../hooks/use-dissect-workspace";

/**
 * Dissect Diff overview: summary, changed folder/file hierarchy, and
 * architecture impact. Clicking a changed file opens that file's snapshot
 * diff; explanations pop up on the exact added/removed lines there.
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
  const knownConceptKeys = Object.entries(handle.slice.knowledge?.concepts ?? {})
    .filter(([, familiarity]) => familiarity === "comfortable")
    .map(([key]) => key);
  const filesByPath = new Map(diff.changedFiles.map((file) => [file.path, file]));
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
      <Text style={styles.hint}>{t("dissect.diff.blockHint")}</Text>

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
                changedFile={filesByPath.get(filePath) ?? null}
                onOpenDiffFile={onOpenDiffFile}
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
  onOpenDiffFile,
}: {
  filePath: string;
  changedFile: DiffChangedFile | null;
  onOpenDiffFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const handleOpen = useCallback(() => onOpenDiffFile(filePath), [filePath, onOpenDiffFile]);
  const statusLabel = changedFile ? t(`dissect.diff.status.${changedFile.status}`) : "";
  const fileLabel = `${filePath.split("/").pop()}${statusLabel ? ` · ${statusLabel}` : ""}`;

  return (
    <View>
      <Pressable
        style={styles.fileNameButton}
        onPress={handleOpen}
        testID={`dissect-diff-file-${filePath}`}
      >
        <Text style={styles.fileName}>{fileLabel}</Text>
      </Pressable>
      {changedFile?.summary ? <Text style={styles.fileSummary}>{changedFile.summary}</Text> : null}
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
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
  fileNameButton: {
    marginLeft: theme.spacing[3],
    alignSelf: "flex-start",
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
  impactText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
}));
