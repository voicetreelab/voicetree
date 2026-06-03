import {existsSync, readFileSync, renameSync, rmSync, writeFileSync} from 'fs'
import type {
    FilesystemAuthoringFix,
    FilesystemAuthoringValidationError,
    StructureManifest,
} from '@vt/graph-tools/node'
import type {OverridableRuleId} from '@vt/graph-validation'

export type GraphCreateNode = Record<string, unknown> & {
    filename: string
    title: string
    summary: string
    content?: string
    color?: string
}

export type GraphCreateResult = {
    id: string
    path: string
    status: 'ok' | 'warning'
    warning?: string
}

export type GraphCreateSuccess = {
    success: true
    nodes: GraphCreateResult[]
    hint?: string
}

export type NodeVerdictStatus = 'ok' | 'rejected' | 'skipped' | 'warning'

/**
 * Concrete reason for a `skipped` gate verdict. Loud-skip surfaces these so the
 * user can distinguish "gate ran and passed" from "gate didn't fire because…".
 */
export type SkipReason =
    | 'no_schema_plugin'
    | 'unknown_type'
    | 'no_project_detected'
    | 'no_parent_for_live_node'

export type NodeVerdict = {
    readonly path: string
    readonly status: NodeVerdictStatus
    readonly ruleIds?: readonly string[]
    readonly warning?: string
    readonly fixes?: readonly FilesystemAuthoringFix[]
    readonly overriddenRuleIds?: readonly string[]
    readonly typeName?: string
    readonly schemaPath?: string
    readonly skipReason?: SkipReason
    readonly planErrorMessage?: string
}

export type BatchReportSummary = {
    readonly ok: number
    readonly rejected: number
    readonly skipped: number
    readonly warning: number
}

/**
 * Single envelope `vt graph create` emits for the whole batch. The shape is
 * the contract that the agent forecasting-retry consumer parses on stderr
 * when `rejected > 0`. Field set is intentionally minimal — additions should
 * be additive (optional) to keep parsers stable.
 */
export type BatchReport = {
    readonly kind: 'graph_create_batch_result'
    readonly nodes: readonly NodeVerdict[]
    readonly summary: BatchReportSummary
    /**
     * Plan-level errors that are not tied to a single input file (e.g.,
     * manifest format errors). Per-file plan errors are folded into the
     * relevant node's verdict as `status: 'rejected'`.
     */
    readonly planErrors?: readonly FilesystemAuthoringValidationError[]
}

export type GraphUnseenNode = {
    nodeId: string
    title: string
}

export type GraphUnseenSuccess = {
    success: true
    contextNodeId: string
    unseenNodes: GraphUnseenNode[]
}

export type ToolFailure = {
    success: false
    error: string
}

export type GraphCreatePayload = {
    callerTerminalId?: string
    parentNodeId?: string
    nodes?: unknown
    override_with_rationale?: unknown
    agentStatus?: unknown
    statusPhrase?: unknown
}

export type OverrideSpec = {
    readonly ruleId: OverridableRuleId
    readonly rationale: string
}

export type ParsedLiveCreateArgs = {
    mode: 'live'
    nodesFile?: string
    inlineNodeSpecs: string[]
    parentNodeId?: string
    color?: string
    validateOnly: boolean
    overrides: readonly OverrideSpec[]
}

export type ParsedFilesystemModeArgs = {
    mode: 'filesystem'
    inputFilePaths: string[]
    parentPath?: string
    color?: string
    manifest?: StructureManifest
    validateOnly: boolean
    overrides: readonly OverrideSpec[]
}

export type ParsedGraphCreateArgs = ParsedLiveCreateArgs | ParsedFilesystemModeArgs

export type GraphFilesystemOps = {
    existsSync: typeof existsSync
    readFileSync: typeof readFileSync
    renameSync: typeof renameSync
    rmSync: typeof rmSync
    writeFileSync: typeof writeFileSync
}

export type ValidationError = {
    /**
     * Stable, plugin-owned taxonomy identifier (e.g. `body.missing_marker`).
     * This is the value surfaced in `gate_rejection.ruleIds` telemetry and in
     * the rejection envelope so callers can react programmatically. Plugin
     * authors are responsible for keeping these IDs stable across releases.
     */
    readonly ruleId: string
    readonly message: string
    readonly severity: 'error' | 'warning'
    /**
     * Optional JSON-path locator within the body for nested-structure
     * validators. Plain-text validators omit it.
     */
    readonly path?: string
    readonly expected?: unknown
    readonly got?: unknown
}

export type Validator = {
    readonly validate: (rawBody: string) => readonly ValidationError[]
}

export type ValidatorMap = Readonly<Record<string, Validator>>

export type SchemaViolation = {
    readonly kind: 'schema_violation'
    readonly targetPath: string
    readonly typeName: string
    readonly schemaPath: string
    readonly violations: readonly ValidationError[]
}
