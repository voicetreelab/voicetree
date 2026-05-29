import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {b6} from '../../src/scenarios/b6.ts'

describe('b6 — multi-session view + three graph-create shapes', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b6-test-'))
    })
    afterEach(async () => {
        await fs.rm(tempDir, {recursive: true, force: true})
    })

    it('exports a valid ScenarioSpec literal with graph-create minCount=3', () => {
        expect(b6.id).toBe('B6')
        const createExpect = b6.expectedCommands.find((c) => c.verb === 'graph create')
        expect(createExpect?.minCount).toBe(3)
        expect(b6.budgets.tokens).toBe(10_000)
    })

    it('setup writes the 6 seed notes, archive contents, fixture, and session.json', async () => {
        await b6.setup(tempDir)
        for (const name of ['feature-spec.md', 'db-schema.md', 'api-contract.md', 'ui-mock.md', 'perf-notes.md', 'README.md']) {
            expect((await fs.stat(path.join(tempDir, name))).isFile()).toBe(true)
        }
        expect((await fs.stat(path.join(tempDir, 'archive', 'deprecated-router.md'))).isFile()).toBe(true)
        const fixture = await fs.readFile(path.join(tempDir, '_fixtures', 'long-analysis.txt'), 'utf8')
        const nonEmpty = fixture.split('\n').filter((l) => l.trim().length > 0)
        expect(nonEmpty.length).toBe(120)
        expect(fixture).toMatch(/canvas|renderer/i)
        const session = JSON.parse(
            await fs.readFile(path.join(tempDir, '.voicetree', 'session.json'), 'utf8'),
        )
        expect(Object.keys(session.sessions)).toEqual(['default'])
    })

    it('successCriteria passes when sessions, atomic, diamond, and over-length-split all check out', async () => {
        await b6.setup(tempDir)
        await writeSplitSubStepSix(tempDir)
        await writeAtomicGreen(tempDir)
        await writeDiamondNodes(tempDir)
        await writeReviewSession(tempDir)
        const result = await b6.successCriteria(tempDir)
        expect(result.passed).toBe(true)
    })

    it('successCriteria fails (D1) when sub-step-6 nodes drop fixture content', async () => {
        await b6.setup(tempDir)
        await writeReviewSession(tempDir)
        await writeAtomicGreen(tempDir)
        await writeDiamondNodes(tempDir)
        // Single shortened node that mentions the fixture but truncates it.
        await fs.writeFile(
            path.join(tempDir, 'long-analysis.md'),
            [
                '---',
                'source: long-analysis',
                'override_with_rationale: \'{"ruleId": "node_line_limit", "rationale": "preserve the whole analysis without splitting"}\'',
                '---',
                '# long-analysis',
                '',
                'The live-canvas renderer currently re-evaluates layout on every node delta.',
                '(rest of fixture intentionally omitted)',
            ].join('\n'),
        )
        const result = await b6.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/^D[15]:/)
    })

    it('successCriteria fails (D2) when truncation markers appear in sub-step-6 output', async () => {
        await b6.setup(tempDir)
        await writeReviewSession(tempDir)
        await writeAtomicGreen(tempDir)
        await writeDiamondNodes(tempDir)
        const fixture = await fs.readFile(path.join(tempDir, '_fixtures', 'long-analysis.txt'), 'utf8')
        await fs.writeFile(
            path.join(tempDir, 'long-analysis.md'),
            [
                '---',
                'source: long-analysis',
                'override_with_rationale: \'{"ruleId": "node_line_limit", "rationale": "long-analysis fixture preserved verbatim; splitting hides cross-section dependencies"}\'',
                '---',
                '# long-analysis',
                '',
                fixture,
                '[content omitted]',
            ].join('\n'),
        )
        const result = await b6.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/D2:/)
    })

    it('successCriteria fails (D3) when override rationale is trivial', async () => {
        await b6.setup(tempDir)
        await writeReviewSession(tempDir)
        await writeAtomicGreen(tempDir)
        await writeDiamondNodes(tempDir)
        const fixture = await fs.readFile(path.join(tempDir, '_fixtures', 'long-analysis.txt'), 'utf8')
        await fs.writeFile(
            path.join(tempDir, 'long-analysis.md'),
            [
                '---',
                'source: long-analysis',
                'override_with_rationale: \'{"ruleId": "node_line_limit", "rationale": "too long"}\'',
                '---',
                '# long-analysis',
                '',
                fixture,
            ].join('\n'),
        )
        const result = await b6.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/D3:/)
    })

    it('successCriteria fails (A) when the default session is mutated', async () => {
        await b6.setup(tempDir)
        await writeAtomicGreen(tempDir)
        await writeDiamondNodes(tempDir)
        await writeSplitSubStepSix(tempDir)
        await fs.writeFile(
            path.join(tempDir, '.voicetree', 'session.json'),
            JSON.stringify({
                sessions: {
                    default: {viewRoot: '/archive', selection: null, zoom: 1, collapsedFolders: []},
                    review: {viewRoot: '/', selection: 'archive/deprecated-router.md', zoom: 2, collapsedFolders: ['archive']},
                },
                active: 'review',
            }),
        )
        const result = await b6.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/^A: default session/)
    })
})

async function writeReviewSession(tempDir: string): Promise<void> {
    await fs.writeFile(
        path.join(tempDir, '.voicetree', 'session.json'),
        JSON.stringify({
            sessions: {
                default: {viewRoot: '/', selection: null, zoom: 1, collapsedFolders: []},
                review: {
                    viewRoot: '/',
                    selection: 'archive/deprecated-router.md',
                    zoom: 2,
                    collapsedFolders: ['archive'],
                },
            },
            active: 'review',
        }),
    )
}

async function writeAtomicGreen(tempDir: string): Promise<void> {
    await fs.writeFile(
        path.join(tempDir, 'fix-auth-empty-string.md'),
        [
            '---',
            'color: green',
            '---',
            '# auth.ts: readToken null fix',
            '',
            'Previously returned empty string on missing header; now returns null.',
            '',
            '```diff',
            '- if (!raw) return ""',
            '+ if (!raw) return null',
            '```',
        ].join('\n'),
    )
}

async function writeDiamondNodes(tempDir: string): Promise<void> {
    await fs.writeFile(
        path.join(tempDir, 'goals.md'),
        '---\ncolor: blue\n---\n# Goals\n\nShared root.\n',
    )
    await fs.writeFile(
        path.join(tempDir, 'option-a-event-driven.md'),
        '---\ncolor: blue\nparents:\n  - goals\n---\n# Option A: event-driven\n\nQueue + backpressure.\n',
    )
    await fs.writeFile(
        path.join(tempDir, 'option-b-request-response.md'),
        '---\ncolor: blue\nparents:\n  - goals\n---\n# Option B: request-response\n\nCache projections.\n',
    )
    await fs.writeFile(
        path.join(tempDir, 'recommendation.md'),
        [
            '---',
            'color: blue',
            'parents:',
            '  - option-a-event-driven',
            '  - option-b-request-response',
            'edges:',
            '  - { from: option-a-event-driven, edgeLabel: rejected }',
            '  - { from: option-b-request-response, edgeLabel: selected }',
            '---',
            '# Recommendation',
            '',
            '```mermaid',
            'graph LR; A-->R; B-->R',
            '```',
            '',
            'Ship Option B first.',
        ].join('\n'),
    )
    await fs.writeFile(
        path.join(tempDir, 'concern-api.md'),
        '---\ncolor: blue\nparents:\n  - recommendation\n---\n# API change concern\n',
    )
    await fs.writeFile(
        path.join(tempDir, 'concern-frontend.md'),
        '---\ncolor: blue\nparents:\n  - recommendation\n---\n# Frontend concern\n',
    )
    await fs.writeFile(
        path.join(tempDir, 'concern-docs.md'),
        '---\ncolor: blue\nparents:\n  - recommendation\n---\n# Docs concern\n',
    )
}

async function writeSplitSubStepSix(tempDir: string): Promise<void> {
    const fixture = await fs.readFile(path.join(tempDir, '_fixtures', 'long-analysis.txt'), 'utf8')
    const allLines = fixture.split('\n').filter((l) => l.trim().length > 0)
    // 120 lines split across 5 sections of 20 each, all hanging off a shared
    // root → a tree with the root having 5 children.
    const sections = [
        {file: 'la-root.md', parent: undefined, slice: [] as readonly string[]},
        {file: 'la-problem.md', parent: 'la-root', slice: allLines.slice(0, 20)},
        {file: 'la-option-a.md', parent: 'la-root', slice: allLines.slice(20, 40)},
        {file: 'la-option-b.md', parent: 'la-root', slice: allLines.slice(40, 60)},
        {file: 'la-tradeoff.md', parent: 'la-root', slice: allLines.slice(60, 90)},
        {file: 'la-next.md', parent: 'la-root', slice: allLines.slice(90, 120)},
    ]
    for (const s of sections) {
        const fm = s.parent
            ? `---\nsource: long-analysis\nparents:\n  - ${s.parent}\n---\n`
            : `---\nsource: long-analysis\n---\n`
        const body = '# ' + s.file.replace('.md', '') + '\n\n' + s.slice.join('\n') + '\n'
        await fs.writeFile(path.join(tempDir, s.file), fm + body)
    }
}
