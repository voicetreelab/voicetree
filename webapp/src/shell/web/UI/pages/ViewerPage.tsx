import { useEffect, useState, useMemo } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { isRight } from 'fp-ts/lib/Either.js'
import type { Either } from 'fp-ts/lib/Either.js'
import type { TaskEither } from 'fp-ts/lib/TaskEither.js'
import { ReactFlow, ReactFlowProvider, Background, Controls, useNodesState, useEdgesState, useReactFlow, useNodesInitialized } from '@xyflow/react'
import type { Node, Edge as RFEdge, NodeTypes, Viewport } from '@xyflow/react'
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

function ViewerFlow({ id }: { readonly id: string }): JSX.Element {
    const [state, setState] = useState<ViewState>({ phase: 'loading' })
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([])
    const { setViewport, getNodes } = useReactFlow()
    const nodesInitialized: boolean = useNodesInitialized()
    const nodeTypes: NodeTypes = useMemo(() => ({ markdown: MarkdownNode }), [])

    useEffect(() => {
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

    useEffect(() => {
        if (!nodesInitialized || nodes.length === 0) return
        const measured: Node[] = getNodes()
        let minX: number = Infinity, minY: number = Infinity
        let maxX: number = -Infinity, maxY: number = -Infinity
        for (const n of measured) {
            const w: number = n.measured?.width ?? 350
            const h: number = n.measured?.height ?? 350
            if (n.position.x < minX) minX = n.position.x
            if (n.position.y < minY) minY = n.position.y
            if (n.position.x + w > maxX) maxX = n.position.x + w
            if (n.position.y + h > maxY) maxY = n.position.y + h
        }
        const graphW: number = maxX - minX
        const graphH: number = maxY - minY
        const container: HTMLElement | null = document.querySelector('.react-flow')
        const cw: number = container?.clientWidth ?? 1920
        const ch: number = container?.clientHeight ?? 900
        const padding: number = 50
        const zoom: number = Math.min((cw - padding * 2) / graphW, (ch - padding * 2) / graphH, 1)
        const centerX: number = (minX + maxX) / 2
        const centerY: number = (minY + maxY) / 2
        const viewport: Viewport = {
            x: cw / 2 - centerX * zoom,
            y: ch / 2 - centerY * zoom,
            zoom
        }
        void setViewport(viewport)
    }, [nodesInitialized, nodes.length, getNodes, setViewport])

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
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#333" />
                <Controls />
            </ReactFlow>
        </div>
    )
}

export default function ViewerPage(): JSX.Element {
    const { id } = useParams<{ id: string }>()

    if (!id) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-neutral-950">
                <p className="text-neutral-400">No share ID provided.</p>
            </div>
        )
    }

    return (
        <ReactFlowProvider>
            <ViewerFlow id={id} />
        </ReactFlowProvider>
    )
}
