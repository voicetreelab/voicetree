import {describe, it, expect} from 'vitest'
import {buildMarkdownBody} from '@/shell/edge/main/mcp-server/addProgressNodeTool'
import {parseMarkdownToGraphNode} from '@vt/graph-model/pure/graph/markdown-parsing/parse-markdown-to-node'
import type {Graph, GraphNode} from '@vt/graph-model/pure/graph'

const EMPTY_GRAPH: Graph = {
    nodes: {},
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map()
}

function buildMinimalMarkdown(overrides?: {content?: string}): string {
    return buildMarkdownBody({
        title: 'Test Title',
        summary: 'Summary text.',
        content: overrides?.content,
        codeDiffs: undefined,
        filesChanged: undefined,
        diagram: undefined,
        notes: undefined,
        linkedArtifacts: undefined,
        complexityScore: undefined,
        complexityExplanation: undefined,
        color: 'blue',
        agentName: 'test-agent',
        parentLinks: [{baseName: 'parent-task', edgeLabel: undefined}],
    })
}

describe('buildMarkdownBody → parseMarkdownToGraphNode roundtrip', () => {
    it('contentWithoutYamlOrLinks does not start with an empty line', () => {
        const markdown: string = buildMinimalMarkdown()
        const node: GraphNode = parseMarkdownToGraphNode(markdown, 'test.md', EMPTY_GRAPH)

        const firstLine: string = node.contentWithoutYamlOrLinks.split('\n')[0]
        expect(firstLine.trim()).not.toBe('')
    })

    it('contentWithoutYamlOrLinks does not start with an empty line when content is provided', () => {
        const markdown: string = buildMinimalMarkdown({content: 'Extra details here.'})
        const node: GraphNode = parseMarkdownToGraphNode(markdown, 'test.md', EMPTY_GRAPH)

        const firstLine: string = node.contentWithoutYamlOrLinks.split('\n')[0]
        expect(firstLine.trim()).not.toBe('')
    })

    it('renders linkedArtifacts as markdown links without creating graph edges', () => {
        const markdown: string = buildMarkdownBody({
            title: 'Test Title',
            summary: 'Summary text.',
            content: undefined,
            codeDiffs: undefined,
            filesChanged: undefined,
            diagram: undefined,
            notes: undefined,
            linkedArtifacts: ['proposal', 'tasks.md'],
            complexityScore: undefined,
            complexityExplanation: undefined,
            color: 'blue',
            agentName: 'test-agent',
            parentLinks: [{baseName: 'parent-task', edgeLabel: undefined}],
        })

        expect(markdown).toContain('- [proposal](proposal.md)')
        expect(markdown).toContain('- [tasks](tasks.md)')
        expect(markdown).not.toContain('[[proposal]]')
        expect(markdown).not.toContain('[[tasks.md]]')

        const node: GraphNode = parseMarkdownToGraphNode(markdown, 'test.md', EMPTY_GRAPH)
        expect(node.outgoingEdges).toEqual([{targetId: 'parent-task', label: ''}])
    })
})
