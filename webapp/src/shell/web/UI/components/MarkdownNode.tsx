import React, { memo } from 'react'
import type { JSX } from 'react'
import { Handle, Position } from '@xyflow/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownNodeData {
    label: string
    content: string
    color?: string
    [key: string]: unknown
}

function MarkdownNodeComponent({ data }: { data: MarkdownNodeData }): JSX.Element {
    return (
        <div
            className="min-w-[200px] max-w-[350px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-lg"
            style={data.color ? { borderColor: data.color } : undefined}
        >
            <Handle type="target" position={Position.Top} className="!bg-neutral-600" />

            <div className="border-b border-neutral-800 px-3 py-2">
                <h3 className="text-sm font-semibold text-neutral-100 leading-tight">{data.label}</h3>
            </div>

            {data.content && (
                <div className="max-h-[300px] overflow-y-auto px-3 py-2">
                    <div className="prose prose-invert prose-xs max-w-none prose-headings:text-neutral-100 prose-p:text-neutral-300 prose-a:text-blue-400 prose-strong:text-neutral-200 prose-code:rounded prose-code:bg-neutral-800 prose-code:px-1 prose-code:py-0.5 prose-code:text-neutral-300 prose-pre:bg-neutral-950 prose-pre:border prose-pre:border-neutral-800 prose-li:text-neutral-300">
                        <Markdown remarkPlugins={[remarkGfm]}>{data.content}</Markdown>
                    </div>
                </div>
            )}

            <Handle type="source" position={Position.Bottom} className="!bg-neutral-600" />
        </div>
    )
}

export const MarkdownNode: React.MemoExoticComponent<typeof MarkdownNodeComponent> = memo(MarkdownNodeComponent)
