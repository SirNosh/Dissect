import type { CodeBlockDissection, ConceptReference } from "@getpaseo/protocol/dissect";

export type DissectAnnotationStatus = "idle" | "analyzing" | "ready" | "error";

/** Annotation payload handed to the file source viewer. */
export interface DissectFileAnnotations {
  status: DissectAnnotationStatus;
  blocks: CodeBlockDissection[];
  concepts: ConceptReference[];
  knownConceptKeys: string[];
  onConceptAction: ((key: string, action: "know" | "explain_more") => void) | null;
}
