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
  folderStateSize: z.number().int().nonnegative(),
  selectionSize: z.number().int().nonnegative(),
})
export type SessionInfo = z.infer<typeof SessionInfoSchema>

export const FolderStateSchema = z.enum(['expanded', 'collapsed', 'hidden'])
export type FolderState = z.infer<typeof FolderStateSchema>

export const FolderStateEntrySchema = z.tuple([z.string(), FolderStateSchema])
export type FolderStateEntry = z.infer<typeof FolderStateEntrySchema>

export const ActiveViewSchema = z.object({
  viewId: z.string().min(1),
  name: z.string(),
})
export type ActiveView = z.infer<typeof ActiveViewSchema>

export const FolderStateResponseSchema = z.object({
  folderState: z.array(FolderStateEntrySchema),
  activeView: ActiveViewSchema,
})
export type FolderStateResponse = z.infer<typeof FolderStateResponseSchema>

export const FolderStatePatchRequestSchema = z.object({
  state: FolderStateSchema,
})
export type FolderStatePatchRequest = z.infer<typeof FolderStatePatchRequestSchema>

export const FolderStateBatchUpdateSchema = z.object({
  path: z.string().min(1),
  state: FolderStateSchema,
})
export type FolderStateBatchUpdate = z.infer<typeof FolderStateBatchUpdateSchema>

export const FolderStateBatchRequestSchema = z.object({
  updates: z.array(FolderStateBatchUpdateSchema).min(1),
})
export type FolderStateBatchRequest = z.infer<typeof FolderStateBatchRequestSchema>

export const ViewRecordSchema = z.object({
  viewId: z.string().min(1),
  name: z.string(),
  isActive: z.boolean(),
})
export type ViewRecord = z.infer<typeof ViewRecordSchema>

export const ListViewsResponseSchema = z.array(ViewRecordSchema)
export type ListViewsResponse = z.infer<typeof ListViewsResponseSchema>

export const CreateViewRequestSchema = z.object({
  name: z.string().min(1),
})
export type CreateViewRequest = z.infer<typeof CreateViewRequestSchema>

export const CloneViewRequestSchema = z.object({
  name: z.string().min(1),
})
export type CloneViewRequest = z.infer<typeof CloneViewRequestSchema>

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
    folderTree: z.array(z.unknown()),
  }),
  folderState: z.array(FolderStateEntrySchema),
  activeView: ActiveViewSchema,
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

export const SetWritePathRequestSchema = z.object({
  path: z.string(),
})
export type SetWritePathRequest = z.infer<typeof SetWritePathRequestSchema>
