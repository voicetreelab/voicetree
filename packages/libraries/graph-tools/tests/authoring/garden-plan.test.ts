import {describe, it, expect} from 'vitest'
import {
    basenameNoExt,
    buildGardenPlan,
    extractWikilinkBasenames,
    firstHeadingTitle,
    formatGardenPlan,
    parseGardenPlan,
    renderFolderNote,
    slugifyTitle,
    stripYamlFrontmatter,
    type GardenFolderNode,
} from '../../src/authoring/garden/plan'

describe('slugifyTitle', () => {
    it('lowercases and dashes non-alphanumerics', () => {
        expect(slugifyTitle('Replace CLI-hook status!')).toBe('replace-cli-hook-status')
    })
    it('falls back to "cluster" for empty/symbol-only titles', () => {
        expect(slugifyTitle('???')).toBe('cluster')
    })
    it('truncates at a word boundary', () => {
        const slug = slugifyTitle('one two three four five six seven eight nine ten eleven twelve', 20)
        expect(slug.length).toBeLessThanOrEqual(20)
        expect(slug.endsWith('-')).toBe(false)
    })
})

describe('extractWikilinkBasenames', () => {
    it('extracts targets, strips paths/ext, handles pipe labels', () => {
        const content = '- parent [[node_9k9zeg]]\nsee [[sub/dir/nuke-list.md|the nuke]] and [[Add-Status-Plan]]'
        expect(extractWikilinkBasenames(content)).toEqual(['node_9k9zeg', 'nuke-list', 'Add-Status-Plan'])
    })
    it('ignores empty wikilinks', () => {
        expect(extractWikilinkBasenames('text [[]] more')).toEqual([])
    })
})

describe('stripYamlFrontmatter / firstHeadingTitle', () => {
    it('strips YAML frontmatter then reads the H1', () => {
        const content = '---\ncolor: green\n---\n# My Title\n\nbody'
        expect(stripYamlFrontmatter(content).startsWith('# My Title')).toBe(true)
        expect(firstHeadingTitle(content, 'fallback')).toBe('My Title')
    })
    it('falls back to first non-empty line, then the fallback', () => {
        expect(firstHeadingTitle('\n\nplain first line\n', 'fb')).toBe('plain first line')
        expect(firstHeadingTitle('   \n  \n', 'fb')).toBe('fb')
    })
})

describe('buildGardenPlan', () => {
    const nodes: readonly GardenFolderNode[] = [
        {filename: 'a1.md', title: 'Alpha One', outgoingBasenames: ['a2']},
        {filename: 'a2.md', title: 'Alpha Two', outgoingBasenames: ['a1']},
        {filename: 'b1.md', title: 'Beta One', outgoingBasenames: ['b2']},
        {filename: 'b2.md', title: 'Beta Two', outgoingBasenames: ['b1']},
        {filename: 'lonely.md', title: 'Lonely Node', outgoingBasenames: []},
    ]

    it('groups the two connected pairs and leaves the singleton as a leftover', () => {
        const plan = buildGardenPlan(nodes)
        expect(plan.clusters).toHaveLength(2)
        const memberSets = plan.clusters.map((c) => [...c.members].sort())
        expect(memberSets).toContainEqual(['a1.md', 'a2.md'])
        expect(memberSets).toContainEqual(['b1.md', 'b2.md'])
        expect(plan.leftovers).toEqual(['lonely.md'])
    })

    it('produces non-empty, unique slug folder names', () => {
        const plan = buildGardenPlan(nodes)
        const names = plan.clusters.map((c) => c.folderName)
        expect(new Set(names).size).toBe(names.length)
        names.forEach((n) => expect(n).toMatch(/^[a-z0-9-]+$/))
    })

    it('ignores wikilinks to nodes outside the folder set (bounded clustering)', () => {
        // x↔y are a community; the [[external-thing]] link points outside the set and
        // must be dropped. p/q are unrelated singletons so the x-y community is a
        // minority of the folder (not filtered as the whole-folder "oversized" cluster).
        const withExternal: readonly GardenFolderNode[] = [
            {filename: 'x.md', title: 'X', outgoingBasenames: ['external-thing', 'y']},
            {filename: 'y.md', title: 'Y', outgoingBasenames: ['x']},
            {filename: 'p.md', title: 'P', outgoingBasenames: []},
            {filename: 'q.md', title: 'Q', outgoingBasenames: []},
        ]
        const plan = buildGardenPlan(withExternal)
        expect(plan.clusters).toHaveLength(1)
        expect([...plan.clusters[0].members].sort()).toEqual(['x.md', 'y.md'])
        expect([...plan.leftovers].sort()).toEqual(['p.md', 'q.md'])
    })
})

describe('formatGardenPlan / parseGardenPlan round-trip', () => {
    it('parses the rendered plan back to the same non-leftover groups', () => {
        const nodes: readonly GardenFolderNode[] = [
            {filename: 'a1.md', title: 'Alpha One', outgoingBasenames: ['a2']},
            {filename: 'a2.md', title: 'Alpha Two', outgoingBasenames: ['a1']},
            {filename: 'lonely.md', title: 'Lonely', outgoingBasenames: []},
        ]
        const plan = buildGardenPlan(nodes)
        const titleOf = new Map(nodes.map((n) => [n.filename, n.title]))
        const text = formatGardenPlan(plan, 'some/folder', titleOf)
        const parsed = parseGardenPlan(text)

        expect(parsed).toHaveLength(1)
        expect([...parsed[0].members].sort()).toEqual(['a1.md', 'a2.md'])
        // the _keep_ block (lonely.md) is intentionally dropped — those stay put
    })

    it('drops comments and the _keep_ block, honours edits', () => {
        const text = [
            '# a comment',
            '[topic-one]   # cohesion 0.9',
            '  one.md   # One',
            '  two.md',
            '',
            '[_keep_]',
            '  leftover.md',
        ].join('\n')
        const parsed = parseGardenPlan(text)
        expect(parsed).toEqual([{folderName: 'topic-one', members: ['one.md', 'two.md']}])
    })

    it('throws on a node line with no folder header', () => {
        expect(() => parseGardenPlan('  orphan.md')).toThrow()
    })
})

describe('renderFolderNote', () => {
    it('renders a folder identity note with frontmatter, contents, and an internal parent link', () => {
        const note = renderFolderNote(
            'agent-status-reporting-redesign',
            [
                {filename: 'nuke-list.md', title: 'Nuke the adapter'},
                {filename: 'add-status-plan.md', title: 'Add status preset'},
            ],
            'status-redesign-proposal.md',
        )
        expect(note.startsWith('---\ncolor: green')).toBe(true)
        expect(note).toContain('# agent-status-reporting-redesign')
        expect(note).toContain('- **nuke-list** — Nuke the adapter')
        expect(note).toContain('- parent [[status-redesign-proposal]]')
        expect(note.split('\n').length).toBeLessThanOrEqual(16)
    })

    it('summarises overflow beyond 8 members instead of listing all', () => {
        const members = Array.from({length: 12}, (_, i) => ({filename: `n${i}.md`, title: `Title ${i}`}))
        const note = renderFolderNote('big-cluster', members, 'n0.md')
        expect(note).toContain('- …and 4 more')
    })
})

describe('basenameNoExt', () => {
    it('strips the .md extension', () => {
        expect(basenameNoExt('foo.md')).toBe('foo')
        expect(basenameNoExt('bar')).toBe('bar')
    })
})
