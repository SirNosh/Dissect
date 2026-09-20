import type { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface CreateDissectWorkspaceInput {
  cwd: string;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
  }) => Promise<ReturnType<typeof normalizeWorkspaceDescriptor>>;
  serverId: string;
  navigate: (serverId: string, workspaceId: string, target: WorkspaceTabTarget) => void;
}

export async function runCreateDissectWorkspace(
  input: CreateDissectWorkspaceInput,
): Promise<ReturnType<typeof normalizeWorkspaceDescriptor>> {
  const ensuredWorkspace = await input.ensureWorkspace({
    cwd: input.cwd,
    prompt: "",
    attachments: [],
    withInitialAgent: false,
  });
  input.navigate(input.serverId, ensuredWorkspace.id, { kind: "dissect" });
  return ensuredWorkspace;
}
