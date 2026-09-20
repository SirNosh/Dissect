import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../server/atomic-file.js";

const IdentitySchema = z.object({
  userId: z.string().min(1),
  createdAt: z.string().min(1),
});

export type DissectUserIdentity = z.infer<typeof IdentitySchema>;

function identityPath(paseoHome: string): string {
  return path.join(paseoHome, "dissect", "identity.json");
}

/**
 * Stable anonymous local Dissect installation identity. One UUID per data
 * root; never rebuilt on later knowledge writes. Credentials and LLM keys
 * are not stored here.
 */
export async function loadOrCreateDissectUserIdentity(
  paseoHome: string,
  existingUserId?: string,
): Promise<DissectUserIdentity> {
  const filePath = identityPath(paseoHome);
  try {
    const parsed = IdentitySchema.safeParse(JSON.parse(await fs.readFile(filePath, "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // First launch, or a corrupt identity file.
  }
  const identity: DissectUserIdentity = {
    userId: existingUserId && existingUserId.length > 0 ? existingUserId : randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await writeJsonFileAtomic(filePath, identity);
  return identity;
}
