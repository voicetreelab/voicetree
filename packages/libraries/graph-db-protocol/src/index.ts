import { z } from 'zod'

export * from './owner.ts'
export * from './diagnostics.ts'

export const CONTRACT_VERSION = '0.2.0'

/**
 * Owner-identifying block surfaced by `/health`. Mirrors the seven fields
 * BF-343 must expose so a client can prove "is this the daemon I am allowed
 * to use?": canonical project path, owner nonce, contract version, pid, ppid,
 * bound port, schema version.
 *
 * This is the response-shape projection of OwnerRecord. The pure decision
 * input uses the narrower OwnerHealthIdentity; both are derived from the
 * same on-disk record.
 */
export const HealthOwnerSchema = z.object({
  schemaVersion: z.literal(1),
  canonicalProject: z.string().min(1),
  pid: z.number().int().positive(),
  ppid: z.number().int().nonnegative(),
  port: z.number().int().min(0).max(65535),
  ownerNonce: z.string().min(1),
  contractVersion: z.string().min(1),
})
export type HealthOwner = z.infer<typeof HealthOwnerSchema>

export const HealthResponseSchema = z.object({
  version: z.string(),
  project: z.string().nullable(),
  uptimeSeconds: z.number().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  /**
   * Owner identity for the canonical project this daemon serves. `null`
   * during the projectless startup window (no claim yet) and on legacy
   * projectless daemons (Electron's pre-BF-345 path).
   */
  owner: HealthOwnerSchema.nullable(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

/**
 * vt-daemon (VTD) `/health` wire shapes (BF-372).
 *
 * Sibling of {@link HealthOwnerSchema} / {@link HealthResponseSchema} above.
 * Both daemons report the same identity tuple but tag the response with a
 * distinct `daemonKind` so a probe (parameterised by `daemonKind`) can
 * verify it is talking to the daemon it expected.
 *
 * Co-located here — not under `vt-daemon` — to avoid a would-be cycle:
 * `@vt/daemon-lifecycle` (which hosts `probeOwnerHealth`) needs the VTD
 * schema to validate responses, and `@vt/vt-daemon` already depends on
 * `@vt/daemon-lifecycle`. Sibling co-location keeps both wire shapes in
 * one protocol-level package without runtime import cycles.
 */
export const VtDaemonHealthOwnerSchema = z.object({
  schemaVersion: z.literal(1),
  canonicalProject: z.string().min(1),
  pid: z.number().int().positive(),
  ppid: z.number().int().nonnegative(),
  port: z.number().int().min(0).max(65535),
  ownerNonce: z.string().min(1),
  contractVersion: z.string().min(1),
})
export type VtDaemonHealthOwner = z.infer<typeof VtDaemonHealthOwnerSchema>

export const VtDaemonHealthResponseSchema = z.object({
  version: z.string(),
  project: z.string().nullable(),
  uptimeSeconds: z.number().nonnegative(),
  /**
   * Discriminator. Tagged so a probe that asked for `'vtd'` cannot
   * silently accept a graphd `HealthResponse` that happens to share the
   * other fields. The graphd schema has no `daemonKind` field; the VTD
   * schema requires this literal.
   */
  daemonKind: z.literal('vtd'),
  /**
   * Owner identity. `null` during the projectless startup window between
   * `claimVtDaemonOwner` and `ownerHandle.bindPort` (the handle's
   * `health()` getter returns `null` until the port is bound).
   */
  owner: VtDaemonHealthOwnerSchema.nullable(),
})
export type VtDaemonHealthResponse = z.infer<typeof VtDaemonHealthResponseSchema>

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

export const CollapseStateResponseSchema = z.object({
  collapseSet: z.array(z.string()),
})
export type CollapseStateResponse = z.infer<typeof CollapseStateResponseSchema>

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
  // Number of graph nodes the unload transition removed. Present only on a
  // `'hidden'` set so a caller/UI can detect a no-op purge (a folder that is
  // non-empty on disk yet removed zero nodes is a detectable anomaly).
  removedNodeCount: z.number().int().nonnegative().optional(),
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

export const ProjectStateSchema = z.object({
  projectRoot: z.string(),
  readPaths: z.array(z.string()),
  writeFolderPath: z.string(),
})
export type ProjectState = z.infer<typeof ProjectStateSchema>

export const OpenProjectRequestSchema = z.object({
  path: z.string(),
  writeFolderPath: z.string().optional(),
})
export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>

export const OpenProjectResponseSchema = z.object({
  sessionId: SessionIdSchema,
  writeFolderPath: z.string(),
  projectState: ProjectStateSchema,
  initialProjectedGraph: z.unknown(),
  folderState: z.array(FolderStateEntrySchema),
  activeView: ActiveViewSchema,
})
export type OpenProjectResponse = z.infer<typeof OpenProjectResponseSchema>

export const SetWriteFolderPathRequestSchema = z.object({
  path: z.string(),
})
export type SetWriteFolderPathRequest = z.infer<typeof SetWriteFolderPathRequestSchema>

export const AddReadPathRequestSchema = z.object({
  path: z.string(),
})
export type AddReadPathRequest = z.infer<typeof AddReadPathRequestSchema>

export const UnseenNodeSchema = z.object({
  nodeId: z.string(),
  content: z.string(),
})
export type UnseenNode = z.infer<typeof UnseenNodeSchema>
