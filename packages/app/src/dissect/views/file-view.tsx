import { useMemo } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CodebaseDissection } from "@getpaseo/protocol/dissect";
import { explorerFileFromReadResult } from "@/file-explorer/read-result";
import { useLiveFile } from "@/file-pane/live-file/hook";
import { FileSourceView } from "@/file-pane/source/view";
import { DissectContextChat, type DissectOpenFile } from "../components/context-chat";
import { useDissectFileAnnotations } from "../hooks/use-file-dissection";
import type { DissectWorkspaceHandle } from "../hooks/use-dissect-workspace";

/**
 * File detail inside the Dissect pane: annotated source plus a file-scoped
 * chat. Opening a file from Dissect stays here so block tints are visible.
 */
export function DissectFileView({
  run,
  path,
  lineStart,
  serverId,
  handle,
  onOpenFile,
  onBack,
}: {
  run: CodebaseDissection;
  path: string;
  lineStart?: number;
  serverId: string;
  handle: DissectWorkspaceHandle;
  onOpenFile: DissectOpenFile;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const fileSummary = run.files.find((file) => file.path === path) ?? null;
  const filename = path.split("/").pop() ?? path;
  const live = useLiveFile({
    client: handle.client,
    cwd: handle.cwd,
    path,
    enabled: true,
    liveUpdates: false,
  });
  const explorerFile = live.file ? explorerFileFromReadResult(live.file) : null;
  const textContent = explorerFile?.kind === "text" ? (explorerFile.content ?? "") : "";
  const annotations = useDissectFileAnnotations({
    serverId,
    client: handle.client,
    cwd: handle.cwd,
    path,
    enabled: true,
  });
  const theme = UnistylesRuntime.getTheme();
  const visualTheme = useMemo(
    () => ({
      colorScheme: theme.colorScheme,
      background: theme.colors.surface0,
      foreground: theme.colors.foreground,
      cursor: theme.colors.terminal.cursor,
      foregroundMuted: theme.colors.foregroundMuted,
      border: theme.colors.border,
      selection: theme.colors.terminal.selectionBackground,
      monoFont: theme.fontFamily.mono,
      codeFontSize: theme.fontSize.code,
      syntax: theme.colors.syntax,
    }),
    [theme],
  );
  const location = useMemo(
    () => ({ path, ...(lineStart ? { lineStart } : {}) }),
    [path, lineStart],
  );
  const chatScope = useMemo(() => ({ kind: "file" as const, path }), [path]);

  const headingPath = `/${path}`;
  const backLabel = backLabelFor(
    run,
    path,
    t("dissect.file.backToFolder"),
    t("dissect.folder.back"),
  );

  return (
    <View style={styles.container} testID="dissect-file-view">
      <Pressable onPress={onBack} testID="dissect-file-back">
        <Text style={styles.backLink}>{backLabel}</Text>
      </Pressable>
      <Text style={styles.title}>{headingPath}</Text>
      {fileSummary?.role ? <Text style={styles.role}>{fileSummary.role}</Text> : null}
      {fileSummary?.summary ? <Text style={styles.summary}>{fileSummary.summary}</Text> : null}

      <View style={styles.editorFrame}>
        <View style={styles.editorFill}>
          <FileEditorBody
            isFetching={live.isFetching}
            loadError={live.error}
            textContent={textContent}
            isText={explorerFile?.kind === "text"}
            filename={filename}
            location={location}
            size={explorerFile?.size ?? 0}
            visualTheme={visualTheme}
            annotations={annotations}
            tooLargeMessage={t("panels.file.tooLargeToDisplay")}
            loadErrorMessage={t("dissect.file.loadError")}
          />
        </View>
      </View>

      <View style={styles.chatDock}>
        <DissectContextChat
          handle={handle}
          scope={chatScope}
          headingPath={headingPath}
          onOpenFile={onOpenFile}
        />
      </View>
    </View>
  );
}

function FileEditorBody({
  isFetching,
  loadError,
  textContent,
  isText,
  filename,
  location,
  size,
  visualTheme,
  annotations,
  tooLargeMessage,
  loadErrorMessage,
}: {
  isFetching: boolean;
  loadError: string | null;
  textContent: string;
  isText: boolean;
  filename: string;
  location: { path: string; lineStart?: number };
  size: number;
  visualTheme: Parameters<typeof FileSourceView>[0]["theme"];
  annotations: ReturnType<typeof useDissectFileAnnotations>;
  tooLargeMessage: string;
  loadErrorMessage: string;
}) {
  if (isFetching) {
    return (
      <View style={styles.editorPlaceholder}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (loadError || !isText) {
    return (
      <View style={styles.editorPlaceholder}>
        <Text style={styles.loadError}>{loadError ?? loadErrorMessage}</Text>
      </View>
    );
  }
  return (
    <FileSourceView
      content={textContent}
      filename={filename}
      location={location}
      navigationRevision={location.lineStart ?? 0}
      size={size}
      theme={visualTheme}
      tooLargeMessage={tooLargeMessage}
      dissectAnnotations={annotations}
    />
  );
}

export function parentFolderPath(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  if (slash === -1) return ".";
  return filePath.slice(0, slash);
}

function backLabelFor(
  run: CodebaseDissection,
  filePath: string,
  folderLabel: string,
  architectureLabel: string,
): string {
  const parent = parentFolderPath(filePath);
  if (run.folders.some((folder) => folder.path === parent)) return folderLabel;
  return architectureLabel;
}

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
  role: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
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
    width: "100%",
    height: "100%",
  },
  chatDock: {
    flexShrink: 0,
  },
  editorPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  loadError: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
