import { z } from "zod";

// ============================================================================
// Dissect domain schemas
//
// Canonical shared schema module for the Dissect comprehension layer.
// The repository state is the source of truth for every analysis; none of
// these payloads may carry coding-agent transcript data.
// ============================================================================

export const DissectFamiliaritySchema = z.enum(["unseen", "introduced", "learning", "comfortable"]);

export const ConceptReferenceSchema = z.object({
  key: z.string(),
  label: z.string(),
  explanation: z.string(),
  importance: z.enum(["supporting", "important", "core"]),
});

export const ArchitectureNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  path: z.string().nullable(),
  kind: z.enum(["directory", "module", "service", "external"]),
  summary: z.string(),
});

export const ArchitectureEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  kind: z.enum(["imports", "calls", "reads", "writes", "depends_on", "data_flow", "contains"]),
});

export const ArchitectureGraphSchema = z.object({
  nodes: z.array(ArchitectureNodeSchema),
  edges: z.array(ArchitectureEdgeSchema),
});

export const DissectFileSummarySchema = z.object({
  path: z.string(),
  language: z.string().nullable(),
  role: z.string(),
  summary: z.string(),
  exports: z.array(z.string()),
  imports: z.array(z.string()),
  importantSymbols: z.array(z.string()),
  conceptKeys: z.array(z.string()),
});

export const DissectFolderSummarySchema = z.object({
  path: z.string(),
  role: z.string(),
  summary: z.string(),
  files: z.array(z.string()),
  childFolders: z.array(z.string()),
  conceptKeys: z.array(z.string()),
});

export const CodeBlockDissectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  summary: z.string(),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  whyItExists: z.string(),
  conceptKeys: z.array(z.string()),
});

export const FileDissectionSchema = z.object({
  path: z.string(),
  summary: z.string(),
  role: z.string(),
  contentHash: z.string(),
  concepts: z.array(ConceptReferenceSchema),
  blocks: z.array(CodeBlockDissectionSchema),
});

export const CodebaseDissectionSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
  snapshotId: z.string(),
  generatedAt: z.string(),
  summary: z.string(),
  graph: ArchitectureGraphSchema,
  folders: z.array(DissectFolderSummarySchema),
  files: z.array(DissectFileSummarySchema),
  concepts: z.array(ConceptReferenceSchema),
});

export const FolderDissectionSchema = z.object({
  path: z.string(),
  summary: z.string(),
  architectureRole: z.string(),
  files: z.array(DissectFileSummarySchema),
  concepts: z.array(ConceptReferenceSchema),
});

export const DiffBlockDissectionSchema = z.object({
  id: z.string(),
  path: z.string(),
  title: z.string(),
  summary: z.string(),
  oldStartLine: z.number().int().positive().optional(),
  oldEndLine: z.number().int().positive().optional(),
  newStartLine: z.number().int().positive().optional(),
  newEndLine: z.number().int().positive().optional(),
  whyItChanged: z.string(),
  effect: z.string(),
  conceptKeys: z.array(z.string()),
});

export const DiffChangedFileSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  summary: z.string(),
  blocks: z.array(DiffBlockDissectionSchema),
});

export const DiffDissectionSchema = z.object({
  runId: z.string(),
  fromSnapshotId: z.string(),
  toSnapshotId: z.string(),
  generatedAt: z.string(),
  summary: z.string(),
  architectureImpact: z.array(z.string()),
  changedFolders: z.array(
    z.object({
      path: z.string(),
      summary: z.string(),
      files: z.array(z.string()),
    }),
  ),
  changedFiles: z.array(DiffChangedFileSchema),
  concepts: z.array(ConceptReferenceSchema),
});

export const DissectContextAnswerSchema = z.object({
  markdown: z.string(),
  references: z.array(
    z.object({
      path: z.string(),
      startLine: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
    }),
  ),
  concepts: z.array(ConceptReferenceSchema),
});

export const DissectKnowledgeStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  concepts: z.record(z.string(), DissectFamiliaritySchema),
  components: z.record(z.string(), DissectFamiliaritySchema),
});

export const DissectWorkspaceStateSchema = z.object({
  configured: z.boolean(),
  configurationHint: z.string().nullable(),
  run: CodebaseDissectionSchema.nullable(),
  lastDiff: DiffDissectionSchema.nullable(),
  baselineSnapshotId: z.string().nullable(),
  changed: z.boolean(),
  knowledge: DissectKnowledgeStateSchema,
});

// ============================================================================
// Dissect RPC message schemas
// ============================================================================

export const DissectStateGetRequestSchema = z.object({
  type: z.literal("dissect.state.get.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const DissectStateGetResponseSchema = z.object({
  type: z.literal("dissect.state.get.response"),
  payload: z.object({
    requestId: z.string(),
    state: DissectWorkspaceStateSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectCodebaseStartRequestSchema = z.object({
  type: z.literal("dissect.codebase.start.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const DissectCodebaseStartResponseSchema = z.object({
  type: z.literal("dissect.codebase.start.response"),
  payload: z.object({
    requestId: z.string(),
    run: CodebaseDissectionSchema.nullable(),
    baselineSnapshotId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectProgressMessageSchema = z.object({
  type: z.literal("dissect.progress"),
  payload: z.object({
    requestId: z.string(),
    stage: z.enum(["snapshot", "inventory", "file_summaries", "architecture", "diff", "done"]),
    detail: z.string().nullable(),
    completed: z.number().int().nonnegative().nullable(),
    total: z.number().int().nonnegative().nullable(),
  }),
});

export const DissectFolderGetRequestSchema = z.object({
  type: z.literal("dissect.folder.get.request"),
  cwd: z.string(),
  runId: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const DissectFolderGetResponseSchema = z.object({
  type: z.literal("dissect.folder.get.response"),
  payload: z.object({
    requestId: z.string(),
    folder: FolderDissectionSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectFileGetRequestSchema = z.object({
  type: z.literal("dissect.file.get.request"),
  cwd: z.string(),
  path: z.string(),
  requestId: z.string(),
});

export const DissectFileGetResponseSchema = z.object({
  type: z.literal("dissect.file.get.response"),
  payload: z.object({
    requestId: z.string(),
    file: FileDissectionSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectDiffStartRequestSchema = z.object({
  type: z.literal("dissect.diff.start.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const DissectDiffStartResponseSchema = z.object({
  type: z.literal("dissect.diff.start.response"),
  payload: z.object({
    requestId: z.string(),
    diff: DiffDissectionSchema.nullable(),
    baselineSnapshotId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectDiffGetFileRequestSchema = z.object({
  type: z.literal("dissect.diff.get_file.request"),
  cwd: z.string(),
  path: z.string(),
  fromSnapshotId: z.string(),
  toSnapshotId: z.string(),
  requestId: z.string(),
});

export const DissectDiffGetFileResponseSchema = z.object({
  type: z.literal("dissect.diff.get_file.response"),
  payload: z.object({
    requestId: z.string(),
    unifiedDiff: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectChangesCheckRequestSchema = z.object({
  type: z.literal("dissect.changes.check.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const DissectChangesCheckResponseSchema = z.object({
  type: z.literal("dissect.changes.check.response"),
  payload: z.object({
    requestId: z.string(),
    changed: z.boolean(),
    snapshotId: z.string().nullable(),
    baselineSnapshotId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectChatAskRequestSchema = z.object({
  type: z.literal("dissect.chat.ask.request"),
  cwd: z.string(),
  runId: z.string(),
  scope: z.object({
    kind: z.enum(["folder", "file"]),
    path: z.string(),
  }),
  question: z.string().min(1),
  requestId: z.string(),
});

export const DissectChatAskResponseSchema = z.object({
  type: z.literal("dissect.chat.ask.response"),
  payload: z.object({
    requestId: z.string(),
    answer: DissectContextAnswerSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const DissectKnowledgeSignalRequestSchema = z.object({
  type: z.literal("dissect.knowledge.signal.request"),
  cwd: z.string(),
  target: z.object({
    kind: z.enum(["concept", "component"]),
    key: z.string(),
    label: z.string().optional(),
  }),
  action: z.enum(["know", "explain_more"]),
  requestId: z.string(),
});

export const DissectKnowledgeSignalResponseSchema = z.object({
  type: z.literal("dissect.knowledge.signal.response"),
  payload: z.object({
    requestId: z.string(),
    knowledge: DissectKnowledgeStateSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// ============================================================================
// Type exports
// ============================================================================

export type DissectFamiliarity = z.infer<typeof DissectFamiliaritySchema>;
export type ConceptReference = z.infer<typeof ConceptReferenceSchema>;
export type ArchitectureNode = z.infer<typeof ArchitectureNodeSchema>;
export type ArchitectureEdge = z.infer<typeof ArchitectureEdgeSchema>;
export type ArchitectureGraph = z.infer<typeof ArchitectureGraphSchema>;
export type DissectFileSummary = z.infer<typeof DissectFileSummarySchema>;
export type DissectFolderSummary = z.infer<typeof DissectFolderSummarySchema>;
export type CodeBlockDissection = z.infer<typeof CodeBlockDissectionSchema>;
export type FileDissection = z.infer<typeof FileDissectionSchema>;
export type CodebaseDissection = z.infer<typeof CodebaseDissectionSchema>;
export type FolderDissection = z.infer<typeof FolderDissectionSchema>;
export type DiffBlockDissection = z.infer<typeof DiffBlockDissectionSchema>;
export type DiffChangedFile = z.infer<typeof DiffChangedFileSchema>;
export type DiffDissection = z.infer<typeof DiffDissectionSchema>;
export type DissectContextAnswer = z.infer<typeof DissectContextAnswerSchema>;
export type DissectKnowledgeState = z.infer<typeof DissectKnowledgeStateSchema>;
export type DissectWorkspaceState = z.infer<typeof DissectWorkspaceStateSchema>;

export type DissectStateGetRequest = z.infer<typeof DissectStateGetRequestSchema>;
export type DissectStateGetResponse = z.infer<typeof DissectStateGetResponseSchema>;
export type DissectCodebaseStartRequest = z.infer<typeof DissectCodebaseStartRequestSchema>;
export type DissectCodebaseStartResponse = z.infer<typeof DissectCodebaseStartResponseSchema>;
export type DissectProgressMessage = z.infer<typeof DissectProgressMessageSchema>;
export type DissectFolderGetRequest = z.infer<typeof DissectFolderGetRequestSchema>;
export type DissectFolderGetResponse = z.infer<typeof DissectFolderGetResponseSchema>;
export type DissectFileGetRequest = z.infer<typeof DissectFileGetRequestSchema>;
export type DissectFileGetResponse = z.infer<typeof DissectFileGetResponseSchema>;
export type DissectDiffStartRequest = z.infer<typeof DissectDiffStartRequestSchema>;
export type DissectDiffStartResponse = z.infer<typeof DissectDiffStartResponseSchema>;
export type DissectDiffGetFileRequest = z.infer<typeof DissectDiffGetFileRequestSchema>;
export type DissectDiffGetFileResponse = z.infer<typeof DissectDiffGetFileResponseSchema>;
export type DissectChangesCheckRequest = z.infer<typeof DissectChangesCheckRequestSchema>;
export type DissectChangesCheckResponse = z.infer<typeof DissectChangesCheckResponseSchema>;
export type DissectChatAskRequest = z.infer<typeof DissectChatAskRequestSchema>;
export type DissectChatAskResponse = z.infer<typeof DissectChatAskResponseSchema>;
export type DissectKnowledgeSignalRequest = z.infer<typeof DissectKnowledgeSignalRequestSchema>;
export type DissectKnowledgeSignalResponse = z.infer<typeof DissectKnowledgeSignalResponseSchema>;
