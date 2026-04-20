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
