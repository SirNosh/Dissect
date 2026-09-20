import { useEffect, useRef, useState } from "react";
import { FileFind, FileFindModel } from "../find/index.web";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getLanguageForFile } from "@getpaseo/highlight";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { dissectAnnotationsExtension } from "@/dissect/codemirror/annotations.web";
import type { DissectFileAnnotations } from "@/dissect/types";
import type { EditorVisualTheme } from "../editor/extensions.web";
import { editorTheme } from "../editor/extensions.web";
import { selectSourcePresentation, type SourcePresentation } from "./presentation";

interface FileSourceViewProps {
  content: string;
  filename: string;
  location: WorkspaceFileLocation;
  navigationRevision: number;
  size: number;
  theme: EditorVisualTheme;
  tooLargeMessage: string;
  dissectAnnotations?: DissectFileAnnotations | null;
}

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const dissectCompartment = new Compartment();

export function FileSourceView({
  content,
  filename,
  location,
  navigationRevision,
  size,
  theme,
  tooLargeMessage,
  dissectAnnotations,
}: FileSourceViewProps) {
  const presentation = selectSourcePresentation({ size, platform: "web" });
  if (presentation === "unsupported") {
    return (
      <div data-testid="file-source-too-large" style={UNSUPPORTED_STYLE}>
        {tooLargeMessage}
      </div>
    );
  }
  return (
    <ReadonlyCodeMirror
      content={content}
      filename={filename}
      location={location}
      navigationRevision={navigationRevision}
      presentation={presentation}
      theme={theme}
      dissectAnnotations={dissectAnnotations}
    />
  );
}

function ReadonlyCodeMirror({
  content,
  filename,
  location,
  navigationRevision,
  presentation,
  theme,
  dissectAnnotations,
}: Omit<FileSourceViewProps, "size" | "tooLargeMessage"> & {
  presentation: Exclude<SourcePresentation, "unsupported">;
}) {
  const [find] = useState(() => new FileFindModel());
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initial = useRef({ content, filename, presentation, theme, dissectAnnotations });

  useEffect(() => {
    if (!hostRef.current) return;
    const values = initial.current;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: values.content,
        extensions: [
          find.extension,
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({
            tabindex: "0",
            "aria-label": `Source for ${values.filename}`,
          }),
          EditorView.editable.of(false),
          languageCompartment.of(
            languageFor({ filename: values.filename, presentation: values.presentation }),
          ),
          themeCompartment.of(editorTheme(values.theme)),
          dissectCompartment.of(dissectAnnotationsExtension(values.dissectAnnotations ?? null)),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [find]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        dissectCompartment.reconfigure(dissectAnnotationsExtension(dissectAnnotations ?? null)),
      ],
    });
  }, [dissectAnnotations]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, [content]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        languageCompartment.reconfigure(languageFor({ filename, presentation })),
        themeCompartment.reconfigure(editorTheme(theme)),
      ],
    });
  }, [filename, presentation, theme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !location.lineStart) return;
    const line = Math.min(location.lineStart, view.state.doc.lines);
    const from = view.state.doc.line(line).from;
    view.dispatch({ effects: EditorView.scrollIntoView(from, { y: "center" }) });
  }, [location.lineStart, navigationRevision]);

  return (
    <div style={FRAME_STYLE}>
      <div ref={hostRef} data-testid="file-source-editor" style={HOST_STYLE} />
      {dissectAnnotations?.status === "analyzing" ? (
        <div data-testid="dissect-file-analyzing" style={ANALYZING_BADGE_STYLE}>
          Dissecting file…
        </div>
      ) : null}
      <FileFind model={find} editor={viewRef} />
    </div>
  );
}

const ANALYZING_BADGE_STYLE = {
  position: "absolute",
  right: 12,
  bottom: 12,
  padding: "4px 10px",
  borderRadius: 9999,
  fontSize: 11,
  backgroundColor: "rgba(120, 120, 128, 0.25)",
  backdropFilter: "blur(4px)",
  pointerEvents: "none",
} as const;

function languageFor(input: {
  filename: string;
  presentation: Exclude<SourcePresentation, "unsupported">;
}) {
  return input.presentation === "highlighted"
    ? (getLanguageForFile(input.filename)?.extension ?? [])
    : [];
}

const FRAME_STYLE = {
  display: "flex",
  position: "relative",
  flex: 1,
  height: "100%",
  width: "100%",
  minHeight: 0,
  minWidth: 0,
} as const;
const HOST_STYLE = {
  flex: 1,
  height: "100%",
  width: "100%",
  minHeight: 0,
  overflow: "hidden",
} as const;
const UNSUPPORTED_STYLE = {
  alignItems: "center",
  display: "flex",
  flex: 1,
  justifyContent: "center",
} as const;
