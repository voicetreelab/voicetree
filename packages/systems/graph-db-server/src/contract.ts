// OPEN: log file location + --log-level default — design.md Open Question #1, confirm before P3
import { z } from 'zod'

export const CONTRACT_VERSION = '0.3.0'

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

// --- view endpoint ---
export const ViewResponseSchema = z.object({
  output: z.string(),
  format: z.literal('tree-cover'),
})
export type ViewResponse = z.infer<typeof ViewResponseSchema>

export const ExpandOverridesResponseSchema = z.object({
  expandOverrides: z.array(z.string()),
})
export type ExpandOverridesResponse = z.infer<typeof ExpandOverridesResponseSchema>

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

// --- 0.3.0 / graph admin ---
export const UndoResponseSchema = z.object({ performed: z.boolean() })
export type UndoResponse = z.infer<typeof UndoResponseSchema>

export const RedoResponseSchema = z.object({ performed: z.boolean() })
export type RedoResponse = z.infer<typeof RedoResponseSchema>

export const WritePositionsResponseSchema = z.object({ ok: z.literal(true) })
export type WritePositionsResponse = z.infer<typeof WritePositionsResponseSchema>

// --- 0.3.0 / context nodes ---
export const CreateContextNodeRequestSchema = z.object({
  parentNodeId: z.string(),
})
export type CreateContextNodeRequest = z.infer<typeof CreateContextNodeRequestSchema>

export const CreateContextNodeResponseSchema = z.object({
  contextNodeId: z.string(),
})
export type CreateContextNodeResponse = z.infer<typeof CreateContextNodeResponseSchema>

export const CreateContextNodeFromQuestionRequestSchema = z.object({
  relevantNodeIds: z.array(z.string()),
  question: z.string(),
})
export type CreateContextNodeFromQuestionRequest = z.infer<typeof CreateContextNodeFromQuestionRequestSchema>

export const CreateContextNodeFromSelectionRequestSchema = z.object({
  taskNodeId: z.string(),
  selectedNodeIds: z.array(z.string()),
})
export type CreateContextNodeFromSelectionRequest = z.infer<typeof CreateContextNodeFromSelectionRequestSchema>

export const UnseenNodeSchema = z.object({
  nodeId: z.string(),
  content: z.string(),
})
export type UnseenNode = z.infer<typeof UnseenNodeSchema>

export const UnseenNodesResponseSchema = z.object({
  nodes: z.array(UnseenNodeSchema),
})
export type UnseenNodesResponse = z.infer<typeof UnseenNodesResponseSchema>

export const UpdateContainedIdsRequestSchema = z.object({
  newNodeIds: z.array(z.string()),
})
export type UpdateContainedIdsRequest = z.infer<typeof UpdateContainedIdsRequestSchema>

export const PreviewContainedNodeIdsResponseSchema = z.object({
  nodeIds: z.array(z.string()),
})
export type PreviewContainedNodeIdsResponse = z.infer<typeof PreviewContainedNodeIdsResponseSchema>

// --- 0.3.0 / search ---
export const BuildIndexRequestSchema = z.object({
  vaultPath: z.string(),
})
export type BuildIndexRequest = z.infer<typeof BuildIndexRequestSchema>

export const NodeSearchHitSchema = z.object({
  nodePath: z.string(),
  title: z.string(),
  score: z.number(),
  snippet: z.string(),
})
export type NodeSearchHit = z.infer<typeof NodeSearchHitSchema>

export const SearchResponseSchema = z.object({
  hits: z.array(NodeSearchHitSchema),
})
export type SearchResponse = z.infer<typeof SearchResponseSchema>

export const FindFileResponseSchema = z.object({
  files: z.array(z.string()),
})
export type FindFileResponse = z.infer<typeof FindFileResponseSchema>

// --- 0.3.0 / watch ---
export const ProjectRootResponseSchema = z.object({
  projectRoot: z.string().nullable(),
})
export type ProjectRootResponse = z.infer<typeof ProjectRootResponseSchema>

export const SetProjectRootRequestSchema = z.object({
  projectRoot: z.string(),
})
export type SetProjectRootRequest = z.infer<typeof SetProjectRootRequestSchema>

export const WatchStatusResponseSchema = z.object({
  isWatching: z.boolean(),
  directory: z.string().optional(),
})
export type WatchStatusResponse = z.infer<typeof WatchStatusResponseSchema>

// --- 0.3.0 / vault extension ---
export const LoadAndMergeRequestSchema = z.object({
  vaultPath: z.string(),
  isWritePath: z.boolean().optional(),
  createStarterIfEmpty: z.boolean().optional(),
})
export type LoadAndMergeRequest = z.infer<typeof LoadAndMergeRequestSchema>

export const LoadAndMergeResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
})
export type LoadAndMergeResponse = z.infer<typeof LoadAndMergeResponseSchema>
