import { useCallback } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { ScanSearch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ArchitectureMap } from "./architecture-map";
import { ConceptActions } from "./concept-actions";
import { DissectContextChat, type DissectOpenFile } from "./context-chat";
import { DissectProgress } from "./dissect-progress";
import { DissectFolderView } from "../views/folder-view";
import { DissectFileView, parentFolderPath } from "../views/file-view";
import { DissectDiffView } from "../views/diff-view";
import { DissectDiffFileView } from "../views/diff-file-view";
import { useDissectWorkspace, type DissectWorkspaceHandle } from "../hooks/use-dissect-workspace";
import { useDissectStore, type DissectPaneView } from "../state/dissect-store";

const ThemedScanSearch = withUnistyles(ScanSearch);

const dissectPanelPresentation = {
  label: (t) => t("panels.dissect.label"),
  subtitle: (t) => t("panels.dissect.subtitle"),
  tooltip: (t) => t("panels.dissect.tooltip"),
  icon: ThemedScanSearch,
} satisfies PanelPresentation;

function DissectPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId } = usePaneContext();
  const handle = useDissectWorkspace({ serverId, workspaceId });
  const { slice } = handle;

  const confirmUploadIfNeeded = useCallback(async (): Promise<boolean> => {
    if (handle.uploadConsentGiven) return true;
    const confirmed = await confirmDialog({
      title: t("dissect.consent.title"),
      message: t("dissect.consent.message"),
      confirmLabel: t("dissect.consent.continue"),
    });
    if (confirmed) handle.setUploadConsent();
    return confirmed;
  }, [handle, t]);

  const onDissect = useCallback(() => {
    void confirmAndStart(confirmUploadIfNeeded, handle.startCodebase);
  }, [confirmUploadIfNeeded, handle.startCodebase]);

  const onDissectDiff = useCallback(() => {
    void confirmAndStart(confirmUploadIfNeeded, handle.startDiff);
  }, [confirmUploadIfNeeded, handle.startDiff]);

  const openFile = useCallback<DissectOpenFile>(
    (path, lineStart) => {
      handle.setView({
        kind: "file",
        path,
        ...(lineStart ? { lineStart } : {}),
      });
    },
    [handle],
  );

  const openDiffFile = useCallback(
    (path: string) => {
      handle.setView({ kind: "diff-file", path });
    },
    [handle],
  );

  const analyzing = slice.phase === "codebase_analyzing" || slice.phase === "diff_analyzing";
  const showHeaderAction = slice.run !== null && !analyzing;
  const headerActionIsDiff = slice.phase === "changes_detected";

  if (!slice.loaded) {
    return (
      <View style={styles.centerState} testID="dissect-panel-loading">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (!slice.configured) {
    return (
      <View style={styles.centerState} testID="dissect-panel-unconfigured">
        <Text style={styles.title}>{t("dissect.config.needsModel")}</Text>
        <Text style={styles.mutedText}>{slice.configurationHint ?? t("dissect.config.hint")}</Text>
        <DissectRetryButton handle={handle} label={t("common.actions.retry")} />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="dissect-panel">
      {showHeaderAction ? (
        <View style={styles.header}>
          <Button
            variant="default"
            size="sm"
            onPress={headerActionIsDiff ? onDissectDiff : onDissect}
            disabled={handle.agentBusy}
            testID={headerActionIsDiff ? "dissect-action-diff" : "dissect-action-full"}
          >
            {headerActionIsDiff ? t("dissect.action.dissectDiff") : t("dissect.action.dissect")}
          </Button>
          {headerActionIsDiff ? (
            <Text style={styles.newCodeBadge}>{t("dissect.action.newCode")}</Text>
          ) : null}
        </View>
      ) : null}

      {handle.agentBusy ? (
        <Text style={styles.agentBusyNote}>{t("dissect.action.agentBusy")}</Text>
      ) : null}

      {slice.error ? (
        <View style={styles.errorBanner} testID="dissect-error-banner">
          <Text style={styles.errorText}>{slice.error}</Text>
          <Pressable onPress={handle.clearError}>
            <Text style={styles.errorDismiss}>{t("common.actions.dismiss")}</Text>
          </Pressable>
        </View>
      ) : null}

      <DissectMain
        analyzing={analyzing}
        handle={handle}
        serverId={serverId}
        onDissect={onDissect}
        onOpenFile={openFile}
        onOpenDiffFile={openDiffFile}
      />
    </View>
  );
}

async function confirmAndStart(
  confirmUpload: () => Promise<boolean>,
  start: () => void,
): Promise<void> {
  const confirmed = await confirmUpload();
  if (confirmed) start();
}

function DissectMain({
  analyzing,
  handle,
  serverId,
  onDissect,
  onOpenFile,
  onOpenDiffFile,
}: {
  analyzing: boolean;
  handle: DissectWorkspaceHandle;
  serverId: string;
  onDissect: () => void;
  onOpenFile: DissectOpenFile;
  onOpenDiffFile: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { slice } = handle;
  const onBackFromFile = useCallback(() => backFromFile(handle), [handle]);
  const onBackFromDiffFile = useCallback(() => {
    handle.setView({ kind: "diff" });
  }, [handle]);
  if (analyzing) {
    return (
      <DissectProgress
        progress={slice.progress}
        mode={slice.phase === "diff_analyzing" ? "diff" : "codebase"}
      />
    );
  }
  if (slice.run === null) {
    return (
      <View style={styles.centerState} testID="dissect-empty-state">
        <Text style={styles.title}>{t("dissect.empty.title")}</Text>
        <Text style={styles.mutedText}>{t("dissect.empty.subtitle")}</Text>
        <Button
          variant="default"
          size="sm"
          onPress={onDissect}
          disabled={handle.agentBusy}
          testID="dissect-action-first"
        >
          {t("dissect.action.dissect")}
        </Button>
      </View>
    );
  }
  if (slice.view.kind === "file") {
    return (
      <DissectFileView
        key={slice.view.path}
        run={slice.run}
        path={slice.view.path}
        lineStart={slice.view.lineStart}
        serverId={serverId}
        handle={handle}
        onOpenFile={onOpenFile}
        onBack={onBackFromFile}
      />
    );
  }
  if (slice.view.kind === "diff-file" && slice.lastDiff) {
    return (
      <DissectDiffFileView
        key={slice.view.path}
        diff={slice.lastDiff}
        path={slice.view.path}
        handle={handle}
        onBack={onBackFromDiffFile}
      />
    );
  }
  const chat = overviewChat(slice.view);

  return (
    <View style={styles.bodyColumn}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <DissectBody handle={handle} onOpenFile={onOpenFile} onOpenDiffFile={onOpenDiffFile} />
      </ScrollView>
      {chat ? (
        <View style={styles.chatDock}>
          <DissectContextChat
            key={`${chat.scope.kind}:${chat.scope.path}`}
            handle={handle}
            scope={chat.scope}
            heading={
              slice.view.kind === "architecture" ? t("dissect.architecture.askAbout") : undefined
            }
            headingPath={chat.headingPath}
            onOpenFile={onOpenFile}
          />
        </View>
      ) : null}
    </View>
  );
}

function overviewChat(
  view: DissectPaneView,
): { scope: { kind: "folder"; path: string }; headingPath?: string } | null {
  if (view.kind === "diff" || view.kind === "file" || view.kind === "diff-file") return null;
  if (view.kind === "folder") {
    return {
      scope: { kind: "folder", path: view.path },
      headingPath: view.path === "." ? "/" : `/${view.path}`,
    };
  }
  return { scope: { kind: "folder", path: "." } };
}

function backFromFile(handle: DissectWorkspaceHandle): void {
  const { slice } = handle;
  if (slice.view.kind !== "file" || !slice.run) {
    handle.setView({ kind: "architecture" });
    return;
  }
  const parent = parentFolderPath(slice.view.path);
  if (slice.run.folders.some((folder) => folder.path === parent)) {
    handle.setView({ kind: "folder", path: parent });
    return;
  }
  handle.setView({ kind: "architecture" });
}

function DissectRetryButton({ handle, label }: { handle: DissectWorkspaceHandle; label: string }) {
  const onRetry = useCallback(() => {
    if (!handle.client || !handle.cwd || !handle.workspaceKey) return;
    void useDissectStore.getState().loadState(handle.client, handle.workspaceKey, handle.cwd);
  }, [handle.client, handle.cwd, handle.workspaceKey]);
  return (
    <Button variant="default" size="sm" onPress={onRetry}>
      {label}
    </Button>
  );
}

function DissectBody({
  handle,
  onOpenFile,
  onOpenDiffFile,
}: {
  handle: DissectWorkspaceHandle;
  onOpenFile: DissectOpenFile;
  onOpenDiffFile: (path: string) => void;
}) {
  const { slice } = handle;
  const run = slice.run;
  const backToArchitecture = useCallback(() => {
    handle.setView({ kind: "architecture" });
  }, [handle]);
  if (!run) return null;

  if (slice.view.kind === "folder") {
    return (
      <DissectFolderView
        run={run}
        folderPath={slice.view.path}
        handle={handle}
        onOpenFile={onOpenFile}
        onBack={backToArchitecture}
      />
    );
  }

  if (slice.view.kind === "diff" && slice.lastDiff) {
    return (
      <DissectDiffView
        diff={slice.lastDiff}
        handle={handle}
        onOpenDiffFile={onOpenDiffFile}
        onBack={backToArchitecture}
      />
    );
  }

  return <DissectArchitectureView handle={handle} onOpenFile={onOpenFile} />;
}

function DissectArchitectureView({
  handle,
  onOpenFile,
}: {
  handle: DissectWorkspaceHandle;
  onOpenFile: DissectOpenFile;
}) {
  const { t } = useTranslation();
  const { slice } = handle;
  const run = slice.run;
  const knownConceptKeys = Object.entries(slice.knowledge?.concepts ?? {})
    .filter(([, familiarity]) => familiarity === "comfortable")
    .map(([key]) => key);
  const onSelectNode = useCallback(
    (nodeId: string, path: string | null) => {
      if (!run) return;
      const targetPath = path ?? run.graph.nodes.find((node) => node.id === nodeId)?.path ?? null;
      if (!targetPath) return;
      if (run.folders.some((folder) => folder.path === targetPath)) {
        handle.setView({ kind: "folder", path: targetPath });
        return;
      }
      if (run.files.some((file) => file.path === targetPath)) {
        onOpenFile(targetPath);
        return;
      }
      const slash = targetPath.lastIndexOf("/");
      const parent = slash === -1 ? "." : targetPath.slice(0, slash);
      if (run.folders.some((folder) => folder.path === parent)) {
        handle.setView({ kind: "folder", path: parent });
      }
    },
    [handle, onOpenFile, run],
  );
  const openLastDiff = useCallback(() => {
    handle.setView({ kind: "diff" });
  }, [handle]);
  const onKnow = useCallback(
    (key: string) => {
      handle.signalKnowledge({ kind: "concept", key, action: "know" });
    },
    [handle],
  );
  if (!run) return null;

  return (
    <View style={styles.architecture}>
      {slice.phase === "changes_detected" ? (
        <Text style={styles.staleNote}>{t("dissect.architecture.staleNote")}</Text>
      ) : null}

      <Text style={styles.sectionHeading}>{t("dissect.architecture.heading")}</Text>
      <ArchitectureMap graph={run.graph} onSelectNode={onSelectNode} />

      <Text style={styles.sectionHeading}>{t("dissect.architecture.codebase")}</Text>
      <Text style={styles.summaryText}>{run.summary}</Text>

      {slice.lastDiff ? (
        <Pressable onPress={openLastDiff} testID="dissect-open-last-diff">
          <Text style={styles.lastDiffLink}>{t("dissect.architecture.viewLastDiff")}</Text>
        </Pressable>
      ) : null}

      <ConceptActions concepts={run.concepts} knownConceptKeys={knownConceptKeys} onKnow={onKnow} />
    </View>
  );
}

export const dissectPanelRegistration = definePanel("dissect", {
  component: DissectPanel,
  presentation: dissectPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  newCodeBadge: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  agentBusyNote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
  },
  errorBanner: {
    margin: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.destructive,
    gap: theme.spacing[1],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  errorDismiss: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    textAlign: "center",
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    padding: theme.spacing[3],
    gap: theme.spacing[3],
  },
  architecture: {
    gap: theme.spacing[3],
  },
  staleNote: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  sectionHeading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  lastDiffLink: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  bodyColumn: {
    flex: 1,
    minHeight: 0,
  },
  chatDock: {
    flexShrink: 0,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
}));
