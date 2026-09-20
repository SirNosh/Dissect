import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type {
  CodebaseDissection,
  ConceptReference,
  DissectFileSummary,
  DissectFolderSummary,
  DissectKnowledgeState,
} from "@getpaseo/protocol/dissect";
import { Button } from "@/components/ui/button";
import { ConceptActions } from "../components/concept-actions";
import type { DissectOpenFile } from "../components/context-chat";
import type { DissectWorkspaceHandle } from "../hooks/use-dissect-workspace";

/**
 * Folder detail: role, every analyzed direct file with its summary, and
 * knowledge actions. Contextual chat is pinned below this view.
 */
export function DissectFolderView({
  run,
  folderPath,
  handle,
  onOpenFile,
  onBack,
}: {
  run: CodebaseDissection;
  folderPath: string;
  handle: DissectWorkspaceHandle;
  onOpenFile: DissectOpenFile;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const model = buildFolderViewModel(run, folderPath, handle.slice.knowledge);

  const onKnow = useCallback(
    (key: string) => {
      handle.signalKnowledge({ kind: "concept", key, action: "know" });
    },
    [handle],
  );
  const markFolderKnown = useCallback(() => {
    handle.signalKnowledge({
      kind: "component",
      key: folderPath,
      action: model.componentKnown ? "explain_more" : "know",
    });
  }, [model.componentKnown, folderPath, handle]);

  return (
    <View style={styles.container} testID="dissect-folder-view">
      <Pressable onPress={onBack} testID="dissect-folder-back">
        <Text style={styles.backLink}>{t("dissect.folder.back")}</Text>
      </Pressable>

      <Text style={styles.title}>{model.displayPath}</Text>
      {model.folder?.role ? <Text style={styles.role}>{model.folder.role}</Text> : null}
      {model.folder?.summary ? <Text style={styles.summary}>{model.folder.summary}</Text> : null}

      <Button variant="outline" size="sm" onPress={markFolderKnown} testID="dissect-folder-know">
        {model.componentKnown ? t("dissect.folder.markedKnown") : t("dissect.folder.markKnown")}
      </Button>

      <Text style={styles.sectionHeading}>{t("dissect.folder.files")}</Text>
      <View style={styles.fileList}>
        {model.files.length === 0 ? (
          <Text style={styles.emptyText}>{t("dissect.folder.noAnalyzedFiles")}</Text>
        ) : (
          model.files.map((file) => (
            <FolderFileRow key={file.path} file={file} onOpenFile={onOpenFile} />
          ))
        )}
      </View>

      {model.folderConcepts.length > 0 ? (
        <ConceptActions
          concepts={model.folderConcepts}
          knownConceptKeys={model.knownConceptKeys}
          onKnow={onKnow}
        />
      ) : null}
    </View>
  );
}

function buildFolderViewModel(
  run: CodebaseDissection,
  folderPath: string,
  knowledge: DissectKnowledgeState | null,
): {
  folder: DissectFolderSummary | null;
  files: DissectFileSummary[];
  folderConcepts: ConceptReference[];
  knownConceptKeys: string[];
  componentKnown: boolean;
  displayPath: string;
} {
  const folder = run.folders.find((entry) => entry.path === folderPath) ?? null;
  const files = run.files.filter((file) => (folder?.files ?? []).includes(file.path));
  const conceptByKey = new Map(run.concepts.map((concept) => [concept.key, concept]));
  const folderConcepts = (folder?.conceptKeys ?? [])
    .map((key) => conceptByKey.get(key))
    .filter((concept): concept is ConceptReference => Boolean(concept));
  const knownConceptKeys = Object.entries(knowledge?.concepts ?? {})
    .filter(([, familiarity]) => familiarity === "comfortable")
    .map(([key]) => key);
  return {
    folder,
    files,
    folderConcepts,
    knownConceptKeys,
    componentKnown: (knowledge?.components ?? {})[folderPath] === "comfortable",
    displayPath: folderPath === "." ? "/" : `/${folderPath}`,
  };
}

function FolderFileRow({
  file,
  onOpenFile,
}: {
  file: DissectFileSummary;
  onOpenFile: DissectOpenFile;
}) {
  const handlePress = useCallback(() => onOpenFile(file.path), [file.path, onOpenFile]);
  return (
    <Pressable style={styles.fileRow} onPress={handlePress} testID={`dissect-file-${file.path}`}>
      <Text style={styles.fileName}>{file.path.split("/").pop()}</Text>
      <Text style={styles.fileSummary}>{file.summary}</Text>
    </Pressable>
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
  sectionHeading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: theme.spacing[2],
  },
  fileList: {
    gap: theme.spacing[2],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  fileRow: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  fileName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    fontFamily: theme.fontFamily.mono,
  },
  fileSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
