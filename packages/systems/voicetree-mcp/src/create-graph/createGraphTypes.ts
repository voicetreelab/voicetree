import type {NodeDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {ComplexityScore} from '@vt/graph-tools/node'

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

export type GraphParentContext = {
    readonly resolvedGraphParentId: NodeIdAndFilePath
    readonly graphParentBaseName: string
}

export type NodeDraft = {
    readonly node: CreateGraphNodeInput
    readonly nodeId: NodeIdAndFilePath
    readonly baseName: string
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
