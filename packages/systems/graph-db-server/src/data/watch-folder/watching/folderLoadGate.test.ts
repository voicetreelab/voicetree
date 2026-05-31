import { describe, expect, it } from 'vitest'
import { shouldIngestAddedFile } from './folderLoadGate.ts'

/**
 * Black-box tests for the "new folders unloaded by default" ingestion gate.
 * Inputs (added file, mounted watch roots, loaded graph nodes) → boolean; no
 * mocks, no I/O. A graph is modelled as the set of loaded node ids keyed in a
 * record, exactly as `graph.nodes` is shaped.
 */
function graph(...nodeIds: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(nodeIds.map((id) => [id, {}]))
}

const ROOT = '/Users/x/project'
const roots = new Set<string>([ROOT])

describe('shouldIngestAddedFile', () => {
    it('ingests a file dropped directly into a watch root, even when the root is empty', () => {
        expect(shouldIngestAddedFile(`${ROOT}/note.md`, roots, graph())).toBe(true)
    })

    it('ingests a loose new file in a subfolder that already holds a loaded node', () => {
        const g = graph(`${ROOT}/sun/existing.md`)
        expect(shouldIngestAddedFile(`${ROOT}/sun/fresh.md`, roots, g)).toBe(true)
    })

    it('does NOT ingest a file in a brand-new folder with no loaded content', () => {
        const g = graph(`${ROOT}/sun/existing.md`)
        expect(shouldIngestAddedFile(`${ROOT}/wt-feature/readme.md`, roots, g)).toBe(false)
    })

    it('does NOT ingest any file in a brand-new nested folder tree (the worktree flood)', () => {
        // The graph holds the real project notes; none live under the worktree.
        const g = graph(`${ROOT}/a.md`, `${ROOT}/notes/b.md`)
        expect(shouldIngestAddedFile(`${ROOT}/wt-x/packages/app/README.md`, roots, g)).toBe(false)
        expect(shouldIngestAddedFile(`${ROOT}/wt-x/architecture.md`, roots, g)).toBe(false)
        expect(shouldIngestAddedFile(`${ROOT}/wt-x/brain/mem/spec.md`, roots, g)).toBe(false)
    })

    it('stays false across the whole subtree regardless of arrival order (order-independent)', () => {
        // No node ever lives under the new folder, so a deep file and a shallow
        // file both gate the same way — proving independence from addDir/add
        // ordering.
        const g = graph(`${ROOT}/a.md`)
        const deepFirst = shouldIngestAddedFile(`${ROOT}/wt/deep/x.md`, roots, g)
        const shallowSecond = shouldIngestAddedFile(`${ROOT}/wt/y.md`, roots, g)
        expect(deepFirst).toBe(false)
        expect(shallowSecond).toBe(false)
    })

    it('treats a folder loaded only via deep content as loaded for a loose sibling file', () => {
        // `sun/` has no direct node but a descendant is loaded → sun is loaded.
        const g = graph(`${ROOT}/sun/deep/x.md`)
        expect(shouldIngestAddedFile(`${ROOT}/sun/sibling.md`, roots, g)).toBe(true)
    })

    it('ingests files under a freshly-loaded folder once it becomes a watch root', () => {
        // Simulates the user clicking "load" on a worktree: it joins watchRoots.
        const loadedRoots = new Set<string>([ROOT, `${ROOT}/wt-feature`])
        expect(shouldIngestAddedFile(`${ROOT}/wt-feature/readme.md`, loadedRoots, graph())).toBe(true)
    })

    it('does not let a sibling subfolder leak loadedness across folders', () => {
        // `loaded/` has a node; `unloaded/` (its sibling) does not.
        const g = graph(`${ROOT}/loaded/a.md`)
        expect(shouldIngestAddedFile(`${ROOT}/unloaded/a.md`, roots, g)).toBe(false)
        // A path-prefix lookalike must not count as "under": `loaded-2` is not
        // under `loaded`.
        expect(shouldIngestAddedFile(`${ROOT}/loaded-2/a.md`, roots, g)).toBe(false)
    })

    it('matches watch roots regardless of a trailing slash', () => {
        const trailing = new Set<string>([`${ROOT}/sub/`].map((r) => r.replace(/\/+$/, '')))
        expect(shouldIngestAddedFile(`${ROOT}/sub/file.md`, trailing, graph())).toBe(true)
    })

    it('normalizes backslash paths before deciding (cross-platform inputs)', () => {
        const g = graph(`${ROOT}/sun/existing.md`)
        expect(shouldIngestAddedFile(`${ROOT}\\sun\\fresh.md`, roots, g)).toBe(true)
        expect(shouldIngestAddedFile(`${ROOT}\\wt\\fresh.md`, roots, g)).toBe(false)
    })

    it('does not gate a pathological file at the filesystem root', () => {
        expect(shouldIngestAddedFile('/x.md', roots, graph())).toBe(true)
    })
})
