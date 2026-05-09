import type {NodeDelta, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import type {ComplexityScore} from '@vt/graph-tools/node'

export type ParentRef = {
    readonly filename: string
    readonly edgeLabel: string
}

export interface CreateGraphNodeInput {
    readonly filename: string
    readonly title: string
    readonly summary: string
    readonly content?: string
    readonly color?: string
    readonly diagram?: string
    readonly notes?: readonly string[]
    readonly codeDiffs?: readonly string[]
    readonly filesChanged?: readonly string[]
    readonly complexityScore?: ComplexityScore
    readonly complexityExplanation?: string
    readonly linkedArtifacts?: readonly string[]
    readonly parents?: readonly ParentRef[]
}

export interface CreatedNodeInfo {
    readonly nodeId: NodeIdAndFilePath
    readonly baseName: string
}

export type NodeResult = {
    readonly id: string
    readonly path: string
    readonly status: 'ok' | 'warning'
    readonly warning?: string
}

export type Result<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: string }

export type ParentLink = {
    readonly baseName: string
    readonly edgeLabel: string | undefined
}

export type ParentCandidate = {
    readonly link: ParentLink
    readonly position: Position
    readonly nodeId: NodeIdAndFilePath
}

export type GraphParentContext = {
    readonly resolvedGraphParentId: NodeIdAndFilePath
    readonly graphParentPosition: Position
    readonly graphParentBaseName: string
}

export type NodeParentContext = {
    readonly parentLinks: readonly ParentLink[]
    readonly deepestParentPosition: Position
    readonly deepestParentNodeId: NodeIdAndFilePath
}

export type NodeDraft = {
    readonly node: CreateGraphNodeInput
    readonly nodeId: NodeIdAndFilePath
    readonly baseName: string
    readonly nodePosition: Position
    readonly markdownContent: string
    readonly warning: string | undefined
}

export type NodeDeltaDraft = {
    readonly delta: NodeDelta[]
}

export type BatchBuildResult = {
    readonly batchDelta: readonly NodeDelta[]
    readonly allNewNodeIds: readonly NodeIdAndFilePath[]
    readonly createdNodes: ReadonlyMap<string, CreatedNodeInfo>
    readonly results: readonly NodeResult[]
}
