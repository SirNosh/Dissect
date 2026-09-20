import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DissectContextAnswer } from "@getpaseo/protocol/dissect";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import type { DissectWorkspaceHandle } from "../hooks/use-dissect-workspace";

interface ChatEntry {
  id: string;
  question: string;
  answer: DissectContextAnswer | null;
  error: string | null;
}

export type DissectOpenFile = (path: string, lineStart?: number) => void;

/**
 * Contextual Dissect chat for a folder or file. It never sees the coding-agent
 * transcript; questions are answered from the stored dissection plus source.
 */
export function DissectContextChat({
  handle,
  scope,
  heading,
  headingPath,
  onOpenFile,
}: {
  handle: DissectWorkspaceHandle;
  scope: { kind: "folder" | "file"; path: string };
  heading?: string;
  headingPath?: string;
  onOpenFile: DissectOpenFile;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [hasQuestion, setHasQuestion] = useState(false);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [asking, setAsking] = useState(false);

  const setHasQuestionFromText = useCallback((text: string) => {
    setHasQuestion(text.trim().length > 0);
  }, []);

  const submitQuestion = useCallback(() => {
    const trimmed = inputRef.current?.getText().trim() ?? "";
    if (!trimmed || asking) return;
    setAsking(true);
    inputRef.current?.reset();
    setHasQuestion(false);
    void askQuestion({
      handle,
      scope,
      question: trimmed,
      onSettled: (entry) => {
        setChat((entries) => [...entries, entry]);
        setAsking(false);
      },
    });
  }, [asking, handle, scope]);

  const askDisabled = asking || !hasQuestion;

  return (
    <View style={styles.chatSection}>
      <Text style={styles.sectionHeading}>
        {heading ?? t("dissect.folder.askAbout", { path: headingPath ?? scope.path })}
      </Text>
      {chat.map((entry) => (
        <ChatEntryView key={entry.id} entry={entry} onOpenFile={onOpenFile} />
      ))}
      {asking ? <ActivityIndicator size="small" /> : null}
      <View style={styles.chatInputRow}>
        <EditingTextInput
          ref={inputRef}
          style={styles.chatInput}
          onChangeText={setHasQuestionFromText}
          onSubmitEditing={submitQuestion}
          editable={!asking}
          testID="dissect-chat-input"
        />
        <Button
          variant="default"
          size="sm"
          onPress={submitQuestion}
          disabled={askDisabled}
          testID="dissect-chat-send"
        >
          {t("dissect.folder.ask")}
        </Button>
      </View>
    </View>
  );
}

async function askQuestion(input: {
  handle: DissectWorkspaceHandle;
  scope: { kind: "folder" | "file"; path: string };
  question: string;
  onSettled: (entry: ChatEntry) => void;
}): Promise<void> {
  try {
    const answer = await input.handle.ask({
      scope: input.scope,
      question: input.question,
    });
    input.onSettled({
      id: `${Date.now()}-${input.question}`,
      question: input.question,
      answer,
      error: null,
    });
  } catch (error: unknown) {
    input.onSettled({
      id: `${Date.now()}-${input.question}`,
      question: input.question,
      answer: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function ChatEntryView({ entry, onOpenFile }: { entry: ChatEntry; onOpenFile: DissectOpenFile }) {
  let body = null;
  if (entry.answer) {
    body = (
      <View style={styles.chatAnswer}>
        <MarkdownRenderer text={entry.answer.markdown} compact />
        {entry.answer.references.length > 0 ? (
          <View style={styles.referenceList}>
            {entry.answer.references.map((reference) => (
              <ReferenceLink
                key={`${reference.path}-${reference.startLine ?? 0}`}
                path={reference.path}
                startLine={reference.startLine}
                onOpenFile={onOpenFile}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  } else if (entry.error) {
    body = <Text style={styles.chatError}>{entry.error}</Text>;
  }
  return (
    <View style={styles.chatEntry}>
      <Text style={styles.chatQuestion}>{entry.question}</Text>
      {body}
    </View>
  );
}

function ReferenceLink({
  path,
  startLine,
  onOpenFile,
}: {
  path: string;
  startLine?: number;
  onOpenFile: DissectOpenFile;
}) {
  const handlePress = useCallback(() => onOpenFile(path, startLine), [onOpenFile, path, startLine]);
  const label = startLine ? `${path}:${startLine}` : path;
  return (
    <Pressable onPress={handlePress}>
      <Text style={styles.referenceLink}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  chatSection: {
    gap: theme.spacing[2],
  },
  sectionHeading: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: theme.spacing[2],
  },
  chatEntry: {
    gap: theme.spacing[1],
  },
  chatQuestion: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  chatAnswer: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  chatError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  referenceList: {
    marginTop: theme.spacing[1],
    gap: theme.spacing[1],
  },
  referenceLink: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    textDecorationLine: "underline",
  },
  chatInputRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    alignItems: "center",
  },
  chatInput: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    backgroundColor: theme.colors.surface1,
  },
}));
