import {readFileSync} from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import * as graphTools from '../src/node'
import {buildMarkdownBody as legacyBuildMarkdownBody} from '../../../webapp/src/shell/edge/main/mcp-server/addProgressNodeTool'

type BuildMarkdownBodyParams = {
    readonly title: string
    readonly summary: string
    readonly content?: string
    readonly codeDiffs?: readonly string[]
    readonly filesChanged?: readonly string[]
    readonly diagram?: string
    readonly notes?: readonly string[]
    readonly linkedArtifacts?: readonly string[]
    readonly complexityScore?: 'low' | 'medium' | 'high'
    readonly complexityExplanation?: string
    readonly color: string
    readonly agentName: string
    readonly parentLinks: readonly {baseName: string; edgeLabel: string | undefined}[]
}

type BuildMarkdownBodyFn = (params: BuildMarkdownBodyParams) => string

type StructureManifest = {
    readonly format: 'ascii' | 'mermaid'
    readonly source: string
}

type FilesystemAuthoringInput = {
    readonly filename: string
    readonly markdown: string
}

type FilesystemAuthoringPlanResult = {
    readonly status: 'ok' | 'invalid'
    readonly writePlan?: readonly {
        readonly filename: string
        readonly parentFilenames: readonly string[]
        readonly markdown: string
        readonly fixes?: readonly {
            readonly code: string
            readonly message: string
        }[]
    }[]
    readonly errors?: readonly {
        readonly code: string
        readonly message: string
        readonly filename?: string
        readonly ref?: string
        readonly suggestions?: readonly string[]
    }[]
    readonly reports?: readonly {
        readonly filename: string
        readonly fixes: readonly {
            readonly code: string
            readonly message: string
        }[]
        readonly rejections: readonly {
            readonly code: string
            readonly message: string
            readonly suggestions?: readonly string[]
        }[]
    }[]
}

const FIXTURE_ROOT = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'filesystem-graph-authoring'
)

type BuildFilesystemAuthoringPlanFn = (params: {
    readonly inputs: readonly FilesystemAuthoringInput[]
    readonly manifest?: StructureManifest
    readonly agentName?: string
    readonly defaultColor?: string
}) => FilesystemAuthoringPlanResult | Promise<FilesystemAuthoringPlanResult>

function getRequiredExport<T>(name: string): T {
    const candidate: unknown = (graphTools as Record<string, unknown>)[name]
    expect(candidate, `Expected @vt/graph-tools to export ${name}()`).toBeTypeOf('function')
    return candidate as T
}

async function buildFilesystemAuthoringPlan(params: {
    readonly inputs: readonly FilesystemAuthoringInput[]
    readonly manifest?: StructureManifest
    readonly agentName?: string
    readonly defaultColor?: string
}): Promise<FilesystemAuthoringPlanResult> {
    const implementation = getRequiredExport<BuildFilesystemAuthoringPlanFn>('buildFilesystemAuthoringPlan')
    return await implementation(params)
}

describe('filesystem authoring contract', () => {
    it('re-exports buildMarkdownBody with the current agent_name-preserving formatting', () => {
        const params: BuildMarkdownBodyParams = {
            title: 'Filesystem Contract',
            summary: 'Lock the extracted markdown-body formatting.',
            content: 'Implementation detail that should remain below the summary.',
            codeDiffs: undefined,
            filesChanged: ['/tmp/example.ts'],
            diagram: undefined,
            notes: ['Formatting drift here would break attribution recovery.'],
            linkedArtifacts: ['proposal', 'tasks.md'],
            complexityScore: undefined,
            complexityExplanation: undefined,
            color: 'green',
            agentName: 'bf-121-test-agent',
            parentLinks: [{baseName: 'bf-120-filesystem-native-vt-graph-create', edgeLabel: 'implements'}],
        }
        const buildMarkdownBody = getRequiredExport<BuildMarkdownBodyFn>('buildMarkdownBody')

        expect(buildMarkdownBody(params)).toBe(legacyBuildMarkdownBody(params))
        expect(buildMarkdownBody(params)).toContain('agent_name: bf-121-test-agent')
        expect(buildMarkdownBody(params)).toContain('implements [[bf-120-filesystem-native-vt-graph-create]]')
    })

    it('builds a pure write plan from an ASCII structure manifest before any writes occur', async () => {
        const result = await buildFilesystemAuthoringPlan({
            inputs: [
                {filename: 'root.md', markdown: '# Root\n\nTop-level summary.\n'},
                {filename: 'child-a.md', markdown: '# Child A\n\nA detail.\n'},
                {filename: 'child-b.md', markdown: '# Child B\n\nAnother detail.\n'},
            ],
            manifest: {
                format: 'ascii',
                source: [
                    'root',
                    '├── child-a',
                    '└── child-b',
                ].join('\n'),
            },
            agentName: 'bf-121-test-agent',
            defaultColor: 'blue',
        })

        expect(result).toMatchObject({status: 'ok'})
        expect(result.writePlan).toHaveLength(3)
        expect(result.writePlan?.find((entry) => entry.filename === 'child-a.md')).toMatchObject({
            filename: 'child-a.md',
            parentFilenames: ['root.md'],
            markdown: expect.stringContaining('- parent [[root]]'),
        })
        expect(result.writePlan?.find((entry) => entry.filename === 'child-b.md')).toMatchObject({
            filename: 'child-b.md',
            parentFilenames: ['root.md'],
            markdown: expect.stringContaining('agent_name: bf-121-test-agent'),
        })
    })

    it('builds the same pure write-plan contract from a Mermaid manifest', async () => {
        const result = await buildFilesystemAuthoringPlan({
            inputs: [
                {filename: 'root.md', markdown: '# Root\n'},
                {filename: 'child-a.md', markdown: '# Child A\n'},
                {filename: 'child-b.md', markdown: '# Child B\n'},
            ],
            manifest: {
                format: 'mermaid',
                source: [
                    'flowchart TD',
                    'root --> child-a',
                    'root --> child-b',
                ].join('\n'),
            },
            agentName: 'bf-121-test-agent',
        })

        expect(result).toMatchObject({status: 'ok'})
        expect(result.writePlan?.find((entry) => entry.filename === 'child-a.md')?.parentFilenames).toEqual(['root.md'])
        expect(result.writePlan?.find((entry) => entry.filename === 'child-b.md')?.parentFilenames).toEqual(['root.md'])
    })

    it('rejects duplicate targets before returning a write plan', async () => {
        const result = await buildFilesystemAuthoringPlan({
            inputs: [
                {filename: 'duplicate.md', markdown: '# First duplicate\n'},
                {filename: 'duplicate.md', markdown: '# Second duplicate\n'},
            ],
            agentName: 'bf-121-test-agent',
        })

        expect(result).toMatchObject({status: 'invalid'})
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({code: 'duplicate_target', filename: 'duplicate.md'}),
        ]))
        expect(result.writePlan).toBeUndefined()
    })

    it('rejects missing manifest references before returning a write plan', async () => {
        const result = await buildFilesystemAuthoringPlan({
            inputs: [
                {filename: 'root.md', markdown: '# Root\n'},
                {filename: 'child-a.md', markdown: '# Child A\n'},
            ],
            manifest: {
                format: 'ascii',
                source: [
                    'root',
                    '├── child-a',
                    '└── missing-leaf',
                ].join('\n'),
            },
        })

        expect(result).toMatchObject({status: 'invalid'})
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({code: 'missing_ref', ref: 'missing-leaf'}),
        ]))
        expect(result.writePlan).toBeUndefined()
    })

    it('rejects malformed manifests before returning a write plan', async () => {
        const result = await buildFilesystemAuthoringPlan({
            inputs: [
                {filename: 'root.md', markdown: '# Root\n'},
                {filename: 'child-a.md', markdown: '# Child A\n'},
            ],
            manifest: {
                format: 'mermaid',
                source: [
                    'flowchart TD',
                    'root -->',
                ].join('\n'),
            },
        })

        expect(result).toMatchObject({status: 'invalid'})
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({code: 'invalid_manifest'}),
        ]))
        expect(result.writePlan).toBeUndefined()
    })

    it('auto-fixes missing frontmatter from the fixture corpus before building a write plan', async () => {
        const fixtureMarkdown: string = readFileSync(
            path.join(FIXTURE_ROOT, 'fixable', 'missing-frontmatter', 'rough-capture.md'),
            'utf8'
        )

        const result = await buildFilesystemAuthoringPlan({
            inputs: [{filename: 'rough-capture.md', markdown: fixtureMarkdown}],
            agentName: 'bf-127-test-agent',
        })

        expect(result).toMatchObject({status: 'ok'})
        const entry = result.writePlan?.find(candidate => candidate.filename === 'rough-capture.md')
        expect(entry?.markdown).toContain('color: blue')
        expect(entry?.markdown).toContain('agent_name: bf-127-test-agent')
        expect(entry?.markdown).toContain('isContextNode: false')
        expect(entry?.fixes).toEqual(expect.arrayContaining([
            expect.objectContaining({code: 'added_frontmatter'}),
        ]))
        expect(result.reports).toEqual(expect.arrayContaining([
            expect.objectContaining({
                filename: 'rough-capture.md',
                fixes: expect.arrayContaining([
                    expect.objectContaining({code: 'added_frontmatter'}),
                ]),
                rejections: [],
            }),
        ]))
    })

    it('reuses the authoring auto-fix layer for parent soft links and whitespace normalization', async () => {
        const result = await buildFilesystemAuthoringPlan({
            inputs: [
                {filename: 'root.md', markdown: '# Root\n'},
                {filename: 'child.md', markdown: '# Child\n- parent [root]   \nTrailing space here.   \n'},
            ],
            agentName: 'bf-127-test-agent',
        })

        expect(result).toMatchObject({status: 'ok'})
        const childEntry = result.writePlan?.find(entry => entry.filename === 'child.md')
        expect(childEntry?.markdown).toContain('- parent [[root]]')
        expect(childEntry?.markdown).not.toContain('- parent [root]')
        expect(childEntry?.markdown).not.toContain('Trailing space here.   ')
        expect(childEntry?.fixes).toEqual(expect.arrayContaining([
            expect.objectContaining({code: 'converted_structural_soft_links'}),
            expect.objectContaining({code: 'trimmed_trailing_whitespace'}),
            expect.objectContaining({code: 'added_frontmatter'}),
        ]))
    })

    it('rejects oversized fixture nodes with actionable split suggestions', async () => {
        const fixtureMarkdown: string = readFileSync(
            path.join(FIXTURE_ROOT, 'rejectable', 'oversized-node', 'oversized-brief.md'),
            'utf8'
        )

        const result = await buildFilesystemAuthoringPlan({
            inputs: [{filename: 'oversized-brief.md', markdown: fixtureMarkdown}],
        })

        expect(result).toMatchObject({status: 'invalid'})
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'node_too_long',
                filename: 'oversized-brief.md',
                suggestions: expect.arrayContaining([
                    expect.stringContaining('Evidence'),
                ]),
            }),
        ]))
        expect(result.reports).toEqual(expect.arrayContaining([
            expect.objectContaining({
                filename: 'oversized-brief.md',
                rejections: expect.arrayContaining([
                    expect.objectContaining({
                        code: 'node_too_long',
                        suggestions: expect.arrayContaining([
                            expect.stringContaining('Implications'),
                        ]),
                    }),
                ]),
            }),
        ]))
        expect(result.writePlan).toBeUndefined()
    })
})
