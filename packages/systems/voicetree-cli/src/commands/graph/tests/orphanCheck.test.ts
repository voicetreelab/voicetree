import {describe, expect, it} from 'vitest'
import type {FilesystemAuthoringPlanEntry} from '@vt/graph-tools/node'
import {findOrphanNodes} from '../actions/orphanCheck'

function entry(
    filename: string,
    markdown: string,
    parentFilenames: readonly string[] = [],
): FilesystemAuthoringPlanEntry {
    return {filename, markdown, parentFilenames, fixes: []}
}

describe('findOrphanNodes', () => {
    it('flags a single node with no parent line and no --parent', () => {
        const orphans = findOrphanNodes([entry('a.md', '# A\n\nbody.\n')], undefined)

        expect(orphans).toHaveLength(1)
        expect(orphans[0]).toMatchObject({code: 'orphan_node', filename: 'a.md'})
        expect(orphans[0]?.message).toContain('no parent edge')
    })

    it('treats a body parent link as attachment', () => {
        const orphans = findOrphanNodes(
            [entry('a.md', '# A\n\nbody.\n\n- parent [[existing-node]]\n')],
            undefined,
        )

        expect(orphans).toEqual([])
    })

    it('treats a manifest-derived parent line as attachment', () => {
        // assembled markdown carries the manifest parent as a `- parent` line.
        const orphans = findOrphanNodes(
            [entry('child.md', '# Child\n\n- parent [[root]]\n', ['root.md'])],
            undefined,
        )

        expect(orphans).toEqual([])
    })

    it('attaches every parentless node to an external --parent', () => {
        const orphans = findOrphanNodes(
            [entry('a.md', '# A\n'), entry('b.md', '# B\n')],
            'anchor',
        )

        expect(orphans).toEqual([])
    })

    it('still flags the external parent itself when it is in-batch and otherwise parentless', () => {
        // `--parent root` where root.md is also an input: its children attach to it,
        // but root has no parent of its own, so the batch is an island.
        const orphans = findOrphanNodes(
            [
                entry('root.md', '# Root\n'),
                entry('child.md', '# Child\n\n- parent [[root]]\n', ['root.md']),
            ],
            'root',
        )

        expect(orphans).toHaveLength(1)
        expect(orphans[0]).toMatchObject({code: 'orphan_node', filename: 'root.md'})
    })

    it('flags only the unanchored manifest root, not its children', () => {
        const orphans = findOrphanNodes(
            [
                entry('root.md', '# Root\n'),
                entry('a.md', '# A\n\n- parent [[root]]\n', ['root.md']),
                entry('b.md', '# B\n\n- parent [[root]]\n', ['root.md']),
            ],
            undefined,
        )

        expect(orphans.map((o) => o.filename)).toEqual(['root.md'])
    })
})
