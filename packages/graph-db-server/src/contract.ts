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

// --- BF-215 collapse ---
export const CollapseStateResponseSchema = z.object({
  collapseSet: z.array(z.string()),
})
export type CollapseStateResponse = z.infer<typeof CollapseStateResponseSchema>

// --- BF-216 selection + layout ---
export const SelectionModeSchema = z.enum(['replace', 'add', 'remove'])
export type SelectionMode = z.infer<typeof SelectionModeSchema>

export const SelectionRequestSchema = z.object({
  nodeIds: z.array(z.string()),
  mode: SelectionModeSchema,
})
export type SelectionRequest = z.infer<typeof SelectionRequestSchema>

export const SelectionResponseSchema = z.object({
  selection: z.array(z.string()),
})
export type SelectionResponse = z.infer<typeof SelectionResponseSchema>

const SessionLayoutPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const SessionViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const SessionLayoutSchema = z.object({
  positions: z.record(z.string(), SessionLayoutPositionSchema),
  pan: SessionViewportSchema,
  zoom: z.number(),
})

export const LayoutPartialSchema = z.object({
  positions: z.record(z.string(), SessionLayoutPositionSchema).optional(),
  pan: SessionViewportSchema.optional(),
  zoom: z.number().optional(),
})
export type LayoutPartial = z.infer<typeof LayoutPartialSchema>

export const LayoutResponseSchema = z.object({
  layout: SessionLayoutSchema,
})
export type LayoutResponse = z.infer<typeof LayoutResponseSchema>

// --- BF-214 session-projection ---
// Wire format for GET /sessions/:sessionId/state. Mirrors SerializedState from
// @vt/graph-state (the JSON-safe form: Sets → sorted string arrays, Maps →
// sorted tuple arrays). Inner graph-node and folder-tree shapes are validated
// loosely — @vt/graph-model and @vt/graph-state own those contracts.
const PositionSchema = z.object({ x: z.number(), y: z.number() })
const StringTuplePairsSchema = z.array(
  z.tuple([z.string(), z.array(z.string())]),
)

export const LiveStateSnapshotSchema = z.object({
  graph: z
    .object({
      nodes: z.record(z.string(), z.unknown()),
      incomingEdgesIndex: StringTuplePairsSchema,
      nodeByBaseName: StringTuplePairsSchema,
      unresolvedLinksIndex: StringTuplePairsSchema,
    })
    .passthrough(),
  roots: z.object({
    loaded: z.array(z.string()),
    folderTree: z.array(z.unknown()),
  }),
  collapseSet: z.array(z.string()),
  selection: z.array(z.string()),
  layout: z.object({
    positions: z.array(z.tuple([z.string(), PositionSchema])),
    zoom: z.number().optional(),
    pan: PositionSchema.optional(),
    fit: z
      .union([z.object({ paddingPx: z.number() }), z.null()])
      .optional(),
  }),
  meta: z.object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    mutatedAt: z.string().optional(),
  }),
})
export type LiveStateSnapshot = z.infer<typeof LiveStateSnapshotSchema>

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
