import { useEffect, useRef, useState, useCallback } from 'react'
import type { JSX, RefObject } from 'react'
import { useParams } from 'react-router-dom'
import { isRight } from 'fp-ts/lib/Either.js'
import type { Either } from 'fp-ts/lib/Either.js'
import type { TaskEither } from 'fp-ts/lib/TaskEither.js'
import type { Core } from 'cytoscape'
import type { GraphDelta } from '@/pure/graph'
import type { ViewError } from '@/pure/web-share/types'
import { initializeCytoscapeInstance } from '@/shell/UI/views/VoiceTreeGraphViewHelpers/initializeCytoscapeInstance'
import { StyleService } from '@/shell/UI/cytoscape-graph-ui/services/StyleService'
import { applyGraphDeltaToWebUI } from '@/shell/web/applyGraphDeltaToWebUI'
import { viewPipeline } from '@/shell/web/viewPipeline'
import NodeContentPanel from '@/shell/web/UI/components/NodeContentPanel'
import type { SelectedNode } from '@/shell/web/UI/components/NodeContentPanel'

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
    const containerRef: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null)
    const cyRef: RefObject<Core | null> = useRef<Core | null>(null)
    const [state, setState] = useState<ViewState>({ phase: 'loading' })
    const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null)

    const closePanel: () => void = useCallback(() => setSelectedNode(null), [])

    useEffect(() => {
        if (!id || !containerRef.current) return

        const baseUrl: string = import.meta.env.VITE_WORKER_URL ?? window.location.origin
        const styleService: StyleService = new StyleService()
        const { cy } = initializeCytoscapeInstance({
            container: containerRef.current,
            stylesheet: styleService.getCombinedStylesheet()
        })
        cyRef.current = cy

        const run: TaskEither<ViewError, GraphDelta> = viewPipeline(baseUrl)(id)
        void run().then((result: Either<ViewError, GraphDelta>) => {
            if (isRight(result)) {
                applyGraphDeltaToWebUI(cy, result.right)
                cy.on('tap', 'node', (evt) => {
                    const nodeId: string = evt.target.id()
                    const content: string = evt.target.data('content') ?? ''
                    const label: string = evt.target.data('label') ?? ''
                    setSelectedNode({ id: nodeId, content, label })
                })
                cy.on('tap', (evt) => {
                    if (evt.target === cy) setSelectedNode(null)
                })
                cy.fit(undefined, 50)
                setState({ phase: 'ready' })
            } else {
                setState({ phase: 'error', error: result.left })
            }
        })

        return () => { cy.destroy() }
    }, [id])

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
        <div className="relative h-screen w-full bg-neutral-950">
            {state.phase === 'loading' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                    <p className="animate-pulse text-neutral-400">Loading graph...</p>
                </div>
            )}
            <div ref={containerRef} className="h-full w-full" />
            {selectedNode && (
                <NodeContentPanel node={selectedNode} onClose={closePanel} />
            )}
        </div>
    )
}
