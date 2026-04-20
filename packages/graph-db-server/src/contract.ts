// OPEN: log file location + --log-level default — design.md Open Question #1, confirm before P3
import { z } from 'zod'

export const CONTRACT_VERSION = '0.1.0'

export const HealthResponseSchema = z.object({
  version: z.string(),
  vault: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

export const ShutdownResponseSchema = z.object({
  ok: z.literal(true),
})
export type ShutdownResponse = z.infer<typeof ShutdownResponseSchema>

// --- P3 / graph + watcher ---
export const GraphStateSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
  })
  .passthrough()
export type GraphState = z.infer<typeof GraphStateSchema>

// --- P4 / sessions ---
// --- BF-213 session-registry ---
const SessionIdSchema = z.string().uuid()

export const SessionCreateResponseSchema = z.object({
  sessionId: SessionIdSchema,
})
export type SessionCreateResponse = z.infer<typeof SessionCreateResponseSchema>

export const SessionInfoSchema = z.object({
  id: SessionIdSchema,
  lastAccessedAt: z.number().int().nonnegative(),
  collapseSetSize: z.number().int().nonnegative(),
  selectionSize: z.number().int().nonnegative(),
})
export type SessionInfo = z.infer<typeof SessionInfoSchema>

// --- P2 / vault ---
export const VaultStateSchema = z.object({
  vaultPath: z.string(),
  readPaths: z.array(z.string()),
  writePath: z.string(),
})
export type VaultState = z.infer<typeof VaultStateSchema>

export const AddReadPathRequestSchema = z.object({
  path: z.string(),
})
export type AddReadPathRequest = z.infer<typeof AddReadPathRequestSchema>

export const SetWritePathRequestSchema = z.object({
  path: z.string(),
})
export type SetWritePathRequest = z.infer<typeof SetWritePathRequestSchema>
