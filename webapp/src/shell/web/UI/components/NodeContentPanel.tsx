import { useEffect, useCallback } from 'react'
import type { JSX } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface SelectedNode {
    readonly id: string
    readonly label: string
    readonly content: string
}

interface NodeContentPanelProps {
    readonly node: SelectedNode
    readonly onClose: () => void
}

export default function NodeContentPanel({ node, onClose }: NodeContentPanelProps): JSX.Element {
    const handleKeyDown: (e: KeyboardEvent) => void = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose()
    }, [onClose])

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-end p-4 sm:p-6"
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl sm:max-h-[80vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between border-b border-neutral-800 px-5 py-4">
                    <h2 className="mr-3 text-lg font-semibold leading-tight text-neutral-100">
                        {node.label}
                    </h2>
                    <button
                        onClick={onClose}
                        className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
                        aria-label="Close panel"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="max-h-[calc(80vh-4rem)] overflow-y-auto px-5 py-4">
                    {node.content ? (
                        <div className="prose prose-invert prose-sm max-w-none prose-headings:text-neutral-100 prose-p:text-neutral-300 prose-a:text-blue-400 prose-strong:text-neutral-200 prose-code:rounded prose-code:bg-neutral-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-neutral-300 prose-pre:bg-neutral-950 prose-pre:border prose-pre:border-neutral-800 prose-li:text-neutral-300 prose-th:text-neutral-200 prose-td:text-neutral-300">
                            <Markdown remarkPlugins={[remarkGfm]}>
                                {node.content}
                            </Markdown>
                        </div>
                    ) : (
                        <p className="text-sm italic text-neutral-500">No content</p>
                    )}
                </div>
            </div>
        </div>
    )
}
