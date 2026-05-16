// OPEN: log file location + --log-level default — design.md Open Question #1, confirm before P3
import { z } from 'zod'
import { ActiveViewSchema, FolderStateEntrySchema, VaultStateSchema } from '@vt/graph-db-protocol'

export * from '@vt/graph-db-protocol'

const SessionIdSchema = z.string().uuid()

export const OpenVaultRequestSchema = z.object({
  path: z.string(),
  writePath: z.string().optional(),
})
export type OpenVaultRequest = z.infer<typeof OpenVaultRequestSchema>

export const OpenVaultResponseSchema = z.object({
  sessionId: SessionIdSchema,
  writePath: z.string(),
  vaultState: VaultStateSchema,
  initialProjectedGraph: z.unknown(),
  folderState: z.array(FolderStateEntrySchema),
  activeView: ActiveViewSchema,
})
export type OpenVaultResponse = z.infer<typeof OpenVaultResponseSchema>
