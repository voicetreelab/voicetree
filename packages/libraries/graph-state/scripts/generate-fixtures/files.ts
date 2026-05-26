import type { Position } from '@vt/graph-model'

import { markdown } from './markdown.ts'
import { abs, ROOT_A, type MarkdownFile } from './types.ts'

export function flatThreeFiles(positions?: Readonly<Record<string, Position>>): readonly MarkdownFile[] {
    const alphaFrontmatter = positions?.['alpha.md'] ? { position: positions['alpha.md'] } : undefined
    const betaFrontmatter = positions?.['beta.md'] ? { position: positions['beta.md'] } : undefined
    const gammaFrontmatter = positions?.['gamma.md'] ? { position: positions['gamma.md'] } : undefined

    return [
        {
            relativePath: 'alpha.md',
            content: markdown('Alpha', ['Tracks [[Beta]].'], alphaFrontmatter),
        },
        {
            relativePath: 'beta.md',
            content: markdown('Beta', ['Execution detail.'], betaFrontmatter),
        },
        {
            relativePath: 'gamma.md',
            content: markdown('Gamma', ['Loose note.'], gammaFrontmatter),
        },
    ]
}

export function flatFiveFiles(): readonly MarkdownFile[] {
    return [
        ...flatThreeFiles(),
        { relativePath: 'delta.md', content: markdown('Delta', ['Staging note.']) },
        { relativePath: 'epsilon.md', content: markdown('Epsilon', ['Archive note.']) },
    ]
}

export function addNodeFiles(): readonly MarkdownFile[] {
    return [
        ...flatThreeFiles(),
        { relativePath: 'delta.md', content: markdown('Delta', ['New node added for mutation tests.']) },
    ]
}

export function addEdgeFiles(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'alpha.md',
            content: markdown('Alpha', ['Tracks [[Beta]] and [[Gamma]].']),
        },
        {
            relativePath: 'beta.md',
            content: markdown('Beta', ['Execution detail.']),
        },
        {
            relativePath: 'gamma.md',
            content: markdown('Gamma', ['Loose note.']),
        },
    ]
}

export function flatFolderFiles(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'tasks/BF-117.md',
            content: markdown('BF-117', ['Depends on [[BF-118]].']),
        },
        {
            relativePath: 'tasks/BF-118.md',
            content: markdown('BF-118', ['Ready for execution.']),
        },
    ]
}

export function externalIntoFolderFiles(): readonly MarkdownFile[] {
    return [
        { relativePath: 'overview.md', content: markdown('Overview', ['Tracks [[BF-117]].']) },
        ...flatFolderFiles(),
    ]
}

export function folderToExternalFiles(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'tasks/BF-117.md',
            content: markdown('BF-117', ['Escalates into [[Overview]].']),
        },
        {
            relativePath: 'tasks/BF-118.md',
            content: markdown('BF-118', ['Ready for execution.']),
        },
        {
            relativePath: 'overview.md',
            content: markdown('Overview', ['External node outside the folder.']),
        },
    ]
}

export function siblingFolderFiles(): readonly MarkdownFile[] {
    return [
        { relativePath: 'tasks/BF-117.md', content: markdown('BF-117', ['See [[spec]].']) },
        { relativePath: 'notes/spec.md', content: markdown('spec', ['Shared reference note.']) },
        { relativePath: 'notes/retro.md', content: markdown('retro', ['Weekly retro.']) },
    ]
}

export function nestedFolderFiles(positions?: Readonly<Record<string, Position>>): readonly MarkdownFile[] {
    const summaryFrontmatter = positions?.['tasks/summary.md']
        ? { position: positions['tasks/summary.md'] }
        : undefined
    const epicAFrontmatter = positions?.['tasks/epics/epic-a.md']
        ? { position: positions['tasks/epics/epic-a.md'] }
        : undefined
    const epicBFrontmatter = positions?.['tasks/epics/epic-b.md']
        ? { position: positions['tasks/epics/epic-b.md'] }
        : undefined

    return [
        {
            relativePath: 'tasks/summary.md',
            content: markdown('summary', ['Summarises [[epic-a]].'], summaryFrontmatter),
        },
        {
            relativePath: 'tasks/epics/epic-a.md',
            content: markdown('epic-a', ['Depends on [[epic-b]].'], epicAFrontmatter),
        },
        {
            relativePath: 'tasks/epics/epic-b.md',
            content: markdown('epic-b', ['Leaf note.'], epicBFrontmatter),
        },
        {
            relativePath: 'notes/roadmap.md',
            content: markdown('roadmap', ['Relates to [[summary]].']),
        },
    ]
}

export function mixedCollapseFiles(): readonly MarkdownFile[] {
    return [
        ...nestedFolderFiles({
            'tasks/summary.md': { x: 90, y: 120 },
            'tasks/epics/epic-a.md': { x: 260, y: 180 },
            'tasks/epics/epic-b.md': { x: 360, y: 240 },
        }),
        {
            relativePath: 'notes/inbox.md',
            content: markdown('inbox', ['Selected note for visibility tests.'], {
                position: { x: 520, y: 90 },
            }),
        },
        {
            relativePath: 'research/idea.md',
            content: markdown('idea', ['Collapsed sibling folder payload.']),
        },
    ]
}

export function contextNodeFiles(): readonly MarkdownFile[] {
    const alphaId = abs(ROOT_A, 'alpha.md')
    const betaId = abs(ROOT_A, 'beta.md')

    return [
        { relativePath: 'alpha.md', content: markdown('Alpha', ['Referenced node.']) },
        { relativePath: 'beta.md', content: markdown('Beta', ['Referenced node.']) },
        {
            relativePath: 'context.md',
            content: markdown(
                'Context',
                ['Contains a dangling [[missing-target]] link.'],
                {
                    isContextNode: true,
                    containedNodeIds: [alphaId, betaId],
                    color: '#FF00AA',
                    status: 'draft',
                    priority: 2,
                },
            ),
        },
    ]
}

export function multiRootFilesRootA(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'tasks/seed.md',
            content: markdown('seed', ['Core task file.']),
        },
        {
            relativePath: 'overview.md',
            content: markdown('overview', ['Top-level summary.']),
        },
    ]
}

export function multiRootFilesRootAWithNewNode(): readonly MarkdownFile[] {
    return [
        ...multiRootFilesRootA(),
        {
            relativePath: 'tasks/delta.md',
            content: markdown('delta', ['Added during the multi-command sequence.']),
        },
    ]
}

export function multiRootFilesRootB(): readonly MarkdownFile[] {
    return [
        {
            relativePath: 'remote.md',
            content: markdown('remote', ['Secondary root note.']),
        },
    ]
}
