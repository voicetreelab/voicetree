import { z } from 'zod'

export const CONTRACT_VERSION = '0.2.0'

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

export const GraphStateSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()),
  })
  .passthrough()
export type GraphState = z.infer<typeof GraphStateSchema>

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

export const CollapseStateResponseSchema = z.object({
  collapseSet: z.array(z.string()),
})
export type CollapseStateResponse = z.infer<typeof CollapseStateResponseSchema>

export const ViewResponseSchema = z.object({
  output: z.string(),
  format: z.literal('tree-cover'),
})
export type ViewResponse = z.infer<typeof ViewResponseSchema>

export const ExpandOverridesResponseSchema = z.object({
  expandOverrides: z.array(z.string()),
})
export type ExpandOverridesResponse = z.infer<typeof ExpandOverridesResponseSchema>

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
