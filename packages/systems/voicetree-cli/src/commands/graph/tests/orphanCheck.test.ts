import {describe, expect, it} from 'vitest'
import type {FilesystemAuthoringPlanEntry} from '@vt/graph-tools/node-runtime'
import {
    findNodeMustHaveEdgeViolations,
    resolveFilesystemOverrides,
    violationFilenamesByRuleId,
} from '../actions/orphanCheck'

function entry(
    filename: string,
    markdown: string,
    parentFilenames: readonly string[] = [],
): FilesystemAuthoringPlanEntry {
    return {filename, markdown, parentFilenames, fixes: []}
}

describe('findNodeMustHaveEdgeViolations', () => {
    it('flags a single node with no parent line and no --parent', () => {
        const orphans = findNodeMustHaveEdgeViolations([entry('a.md', '# A\n\nbody.\n')], undefined)

        expect(orphans).toHaveLength(1)
        expect(orphans[0]).toMatchObject({ruleId: 'node_must_have_edge', nodeFilename: 'a.md'})
        expect(orphans[0]?.message).toContain('no parent edge')
    })

    it('treats a body parent link as attachment', () => {
        const orphans = findNodeMustHaveEdgeViolations(
            [entry('a.md', '# A\n\nbody.\n\n- parent [[existing-node]]\n')],
            undefined,
        )

        expect(orphans).toEqual([])
    })

    it('treats a manifest-derived parent line as attachment', () => {
        // assembled markdown carries the manifest parent as a `- parent` line.
        const orphans = findNodeMustHaveEdgeViolations(
            [entry('child.md', '# Child\n\n- parent [[root]]\n', ['root.md'])],
            undefined,
        )

        expect(orphans).toEqual([])
    })

    it('attaches every parentless node to an external --parent', () => {
        const orphans = findNodeMustHaveEdgeViolations(
            [entry('a.md', '# A\n'), entry('b.md', '# B\n')],
            'anchor',
        )

        expect(orphans).toEqual([])
    })

    it('still flags the external parent itself when it is in-batch and otherwise parentless', () => {
        // `--parent root` where root.md is also an input: its children attach to it,
        // but root has no parent of its own, so the batch is an island.
        const orphans = findNodeMustHaveEdgeViolations(
            [
                entry('root.md', '# Root\n'),
                entry('child.md', '# Child\n\n- parent [[root]]\n', ['root.md']),
            ],
            'root',
        )

        expect(orphans).toHaveLength(1)
        expect(orphans[0]).toMatchObject({ruleId: 'node_must_have_edge', nodeFilename: 'root.md'})
    })

    it('flags only the unanchored manifest root, not its children', () => {
        const orphans = findNodeMustHaveEdgeViolations(
            [
                entry('root.md', '# Root\n'),
                entry('a.md', '# A\n\n- parent [[root]]\n', ['root.md']),
                entry('b.md', '# B\n\n- parent [[root]]\n', ['root.md']),
            ],
            undefined,
        )

        expect(orphans.map((o) => o.nodeFilename)).toEqual(['root.md'])
    })

    it('resolves node_must_have_edge when a matching override is provided', () => {
        const violations = findNodeMustHaveEdgeViolations([entry('a.md', '# A\n')], undefined)

        const resolved = resolveFilesystemOverrides(violations, [
            {ruleId: 'node_must_have_edge', rationale: 'intentional temporary inbox'},
        ])

        expect(resolved.unresolved).toEqual([])
        expect(resolved.accepted).toEqual([
            {ruleId: 'node_must_have_edge', rationale: 'intentional temporary inbox'},
        ])
    })

    it('indexes overridden filenames by graph validation rule id', () => {
        const violations = findNodeMustHaveEdgeViolations([entry('a.md', '# A\n')], undefined)

        expect(violationFilenamesByRuleId(violations, 'node_must_have_edge').get('a.md')).toEqual([
            'node_must_have_edge',
        ])
    })
})
