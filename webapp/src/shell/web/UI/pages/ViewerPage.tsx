import { useEffect, useState, useMemo } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { isRight } from 'fp-ts/lib/Either.js'
import type { Either } from 'fp-ts/lib/Either.js'
import type { TaskEither } from 'fp-ts/lib/TaskEither.js'
import { ReactFlow, Background, Controls, useNodesState, useEdgesState } from '@xyflow/react'
import type { Node, Edge as RFEdge, NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { GraphDelta } from '@/pure/graph'
import type { ViewError } from '@/pure/web-share/types'
import { viewPipeline } from '@/shell/web/viewPipeline'
import { graphDeltaToReactFlow } from '@/shell/web/graphDeltaToReactFlow'
import { MarkdownNode } from '@/shell/web/UI/components/MarkdownNode'

type ViewState =
    | { readonly phase: 'loading' }
    | { readonly phase: 'ready' }
    | { readonly phase: 'error'; readonly error: ViewError }

function formatViewError(error: ViewError): string {
    switch (error.tag) {
        case 'NotFound':
            return `Share "${error.shareId}" not found.`
        case 'FetchFailed':
            return `Failed to fetch share data (HTTP ${error.status}).`
        case 'ParseFailed':
            return `Failed to parse "${error.file}": ${error.error}`
    }
}

export default function ViewerPage(): JSX.Element {
    const { id } = useParams<{ id: string }>()
    const [state, setState] = useState<ViewState>({ phase: 'loading' })
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([])

    const nodeTypes: NodeTypes = useMemo(() => ({ markdown: MarkdownNode }), [])

    useEffect(() => {
        if (!id) return
        const baseUrl: string = import.meta.env.VITE_WORKER_URL ?? window.location.origin
        const run: TaskEither<ViewError, GraphDelta> = viewPipeline(baseUrl)(id)
        void run().then((result: Either<ViewError, GraphDelta>) => {
            if (isRight(result)) {
                const { nodes: rfNodes, edges: rfEdges } = graphDeltaToReactFlow(result.right)
                setNodes(rfNodes)
                setEdges(rfEdges)
                setState({ phase: 'ready' })
            } else {
                setState({ phase: 'error', error: result.left })
            }
        })
    }, [id, setNodes, setEdges])

    if (!id) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-neutral-950">
                <p className="text-neutral-400">No share ID provided.</p>
            </div>
        )
    }

    if (state.phase === 'error') {
        return (
            <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-8">
                <div className="max-w-md text-center">
                    <div className="mb-4 text-3xl">&#9888;</div>
                    <p className="text-neutral-300">{formatViewError(state.error)}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-screen w-full bg-neutral-950">
            {state.phase === 'loading' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                    <p className="animate-pulse text-neutral-400">Loading graph...</p>
                </div>
            )}
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#333" />
                <Controls />
            </ReactFlow>
        </div>
    )
}
