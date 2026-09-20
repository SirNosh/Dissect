import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DissectProgressState } from "../state/dissect-store";

const CODEBASE_STAGE_ORDER = ["inventory", "file_summaries", "architecture"] as const;
const DIFF_STAGE_ORDER = ["snapshot", "diff"] as const;

type DissectStage = (typeof CODEBASE_STAGE_ORDER)[number] | (typeof DIFF_STAGE_ORDER)[number];

/** Real analysis stages — no fake percentages. */
export function DissectProgress({
  progress,
  mode,
}: {
  progress: DissectProgressState | null;
  mode: "codebase" | "diff";
}) {
  const { t } = useTranslation();
  const currentStage = progress?.stage ?? "snapshot";
  const stages: readonly DissectStage[] =
    mode === "codebase" ? CODEBASE_STAGE_ORDER : DIFF_STAGE_ORDER;
  const currentIndex = (stages as readonly string[]).indexOf(currentStage);

  return (
    <View style={styles.container} testID="dissect-progress">
      <Text style={styles.title}>
        {mode === "codebase"
          ? t("dissect.progress.analyzing")
          : t("dissect.progress.analyzingDiff")}
      </Text>
      {stages.map((stage, index) => {
        const isDone = currentIndex > index || currentStage === "done";
        const isActive = currentIndex === index && currentStage !== "done";
        let label = t(`dissect.progress.stage.${stage}`);
        if (
          stage === "file_summaries" &&
          isActive &&
          progress?.completed !== null &&
          progress?.total !== null &&
          progress
        ) {
          label = t("dissect.progress.stage.file_summaries_count", {
            completed: progress.completed,
            total: progress.total,
          });
        }
        let mark = "○";
        if (isDone) mark = "✓";
        else if (isActive) mark = "•";
        return (
          <View key={stage} style={styles.stageRow}>
            <Text style={[styles.stageMark, isDone && styles.stageMarkDone]}>{mark}</Text>
            <Text style={[styles.stageLabel, isActive && styles.stageLabelActive]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    marginBottom: theme.spacing[2],
  },
  stageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stageMark: {
    color: theme.colors.foregroundMuted,
    width: 16,
    textAlign: "center",
  },
  stageMarkDone: {
    color: theme.colors.success,
  },
  stageLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  stageLabelActive: {
    color: theme.colors.foreground,
  },
}));
