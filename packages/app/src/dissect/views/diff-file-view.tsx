import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DiffBlockDissection, DiffDissection } from "@getpaseo/protocol/dissect";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import { DiffDocument } from "@/git/diff-document";
import { useDissectDiffFile } from "../hooks/use-dissect-diff-file";
import type { DissectWorkspaceHandle } from "../hooks/use-dissect-workspace";

/**
 * One file from a Dissect Diff: the snapshot-to-snapshot delta with
 * change-block tints. Click a tinted block for the block-level explanation.
 */
export function DissectDiffFileView({
  diff,
  path,
  handle,
  onBack,
}: {
  diff: DiffDissection;
  path: string;
  handle: DissectWorkspaceHandle;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const changedFile = diff.changedFiles.find((file) => file.path === path) ?? null;
  const loaded = useDissectDiffFile({
    client: handle.client,
    cwd: handle.cwd,
    path,
    fromSnapshotId: diff.fromSnapshotId,
    toSnapshotId: diff.toSnapshotId,
    enabled: true,
  });
  const theme = UnistylesRuntime.getTheme();
  const files = useMemo(() => (loaded.file ? [loaded.file] : []), [loaded.file]);
  const blocksByPath = useMemo(() => {
    const blocks = new Map<string, DiffBlockDissection[]>();
    if (changedFile && changedFile.blocks.length > 0) {
      blocks.set(path, changedFile.blocks);
    }
    return blocks;
  }, [changedFile, path]);
  const displayPreferences = useMemo(
    () => ({
      layout: "unified" as const,
      wrapLines: true,
      codeFontSize: theme.fontSize.code,
      monoFontFamily: theme.fontFamily.mono,
    }),
    [theme.fontFamily.mono, theme.fontSize.code],
  );
  const statusLabel = changedFile ? t(`dissect.diff.status.${changedFile.status}`) : "";

  return (
    <View style={styles.container} testID="dissect-diff-file-view">
      <Pressable onPress={onBack} testID="dissect-diff-file-back">
        <Text style={styles.backLink}>{t("dissect.diff.backToDiff")}</Text>
      </Pressable>
      <Text style={styles.title}>{`/${path}${statusLabel ? ` · ${statusLabel}` : ""}`}</Text>
      {changedFile?.summary ? <Text style={styles.summary}>{changedFile.summary}</Text> : null}
      <Text style={styles.hint}>{t("dissect.diff.blockHint")}</Text>
      <View style={styles.editorFrame}>
        <View style={styles.editorFill}>
          <DiffFileBody
            isLoading={loaded.isLoading}
            error={loaded.error}
            files={files}
            displayPreferences={displayPreferences}
            blocksByPath={blocksByPath}
            emptyMessage={t("dissect.diff.noTextDiff")}
          />
        </View>
      </View>
    </View>
  );
}

function DiffFileBody({
  isLoading,
  error,
  files,
  displayPreferences,
  blocksByPath,
  emptyMessage,
}: {
  isLoading: boolean;
  error: string | null;
  files: ParsedDiffFile[];
  displayPreferences: {
    layout: "unified";
    wrapLines: boolean;
    codeFontSize: number;
    monoFontFamily: string;
  };
  blocksByPath: ReadonlyMap<string, DiffBlockDissection[]>;
  emptyMessage: string;
}) {
  if (isLoading) {
    return (
      <View style={styles.editorPlaceholder}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.editorPlaceholder}>
        <Text style={styles.loadError}>{error}</Text>
      </View>
    );
  }
  if (files.length === 0) {
    return (
      <View style={styles.editorPlaceholder}>
        <Text style={styles.loadError}>{emptyMessage}</Text>
      </View>
    );
  }
  return (
    <DiffDocument
      files={files}
      displayPreferences={displayPreferences}
      mode={COMMIT_DIFF_MODE}
      dissectBlocksByPath={blocksByPath}
    />
  );
}

const COMMIT_DIFF_MODE = { kind: "commit" } as const;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  backLink: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    fontFamily: theme.fontFamily.mono,
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  editorFrame: {
    flex: 1,
    minHeight: 240,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  },
  editorFill: {
    flex: 1,
    minHeight: 0,
  },
  editorPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  loadError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
