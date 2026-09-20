import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { ConceptReference } from "@getpaseo/protocol/dissect";
import { Button } from "@/components/ui/button";

/**
 * Concept chips. Expanding a chip shows its stored explanation. Further
 * questions belong in the Dissect chat on the same screen, not a second
 * predetermined action.
 */
export function ConceptActions({
  concepts,
  knownConceptKeys,
  onKnow,
}: {
  concepts: ConceptReference[];
  knownConceptKeys: string[];
  onKnow: ((key: string) => void) | null;
}) {
  const { t } = useTranslation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  if (concepts.length === 0) return null;
  const known = new Set(knownConceptKeys);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{t("dissect.concepts.heading")}</Text>
      <View style={styles.chips}>
        {concepts.map((concept) => (
          <ConceptChip
            key={concept.key}
            concept={concept}
            isKnown={known.has(concept.key)}
            isExpanded={expandedKey === concept.key}
            onToggle={setExpandedKey}
            onKnow={onKnow}
          />
        ))}
      </View>
    </View>
  );
}

function ConceptChip({
  concept,
  isKnown,
  isExpanded,
  onToggle,
  onKnow,
}: {
  concept: ConceptReference;
  isKnown: boolean;
  isExpanded: boolean;
  onToggle: (key: string | null) => void;
  onKnow: ((key: string) => void) | null;
}) {
  const { t } = useTranslation();
  const handleToggle = useCallback(() => {
    onToggle(isExpanded ? null : concept.key);
  }, [concept.key, isExpanded, onToggle]);
  const handleKnow = useCallback(() => {
    onKnow?.(concept.key);
    onToggle(null);
  }, [concept.key, onKnow, onToggle]);
  const showKnow = Boolean(onKnow) && !isKnown;

  return (
    <View style={styles.chipBlock}>
      <Pressable
        style={[styles.chip, isKnown && styles.chipKnown]}
        onPress={handleToggle}
        testID={`dissect-concept-${concept.key}`}
      >
        <Text style={[styles.chipLabel, isKnown && styles.chipLabelKnown]}>
          {concept.label}
          {isKnown ? " ✓" : ""}
        </Text>
      </Pressable>
      {isExpanded ? (
        <View style={styles.detail}>
          <Text style={styles.explanation}>{concept.explanation}</Text>
          {showKnow ? (
            <Button
              variant="outline"
              size="sm"
              onPress={handleKnow}
              testID={`dissect-concept-know-${concept.key}`}
            >
              {t("dissect.concepts.know")}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  heading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  chipBlock: {
    maxWidth: "100%",
  },
  chip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  chipKnown: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  chipLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  chipLabelKnown: {
    color: theme.colors.foregroundMuted,
  },
  detail: {
    marginTop: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[2],
  },
  explanation: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
}));
