import { promises as fsp } from 'fs'
import path from 'path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyCommandAsync } from '../src/applyCommand'
import { loadSnapshot } from '../src/fixtures'

const ROOT_B = '/tmp/graph-state-fixtures/root-b'
const REMOTE_ID = `${ROOT_B}/remote.md`

async function setupRootB(): Promise<void> {
    await fsp.mkdir(ROOT_B, { recursive: true })
    await fsp.writeFile(
        path.join(ROOT_B, 'remote.md'),
        '# remote\n\nSecondary root note.\n',
        'utf8',
    )
}

async function teardownRootB(): Promise<void> {
    await fsp.rm(ROOT_B, { recursive: true, force: true })
}

describe('applyCommand LoadRoot', () => {
    beforeAll(setupRootB)
    afterAll(teardownRootB)

    it('adds the root and its nodes to state', async () => {
        const initial = loadSnapshot('050-two-roots-root-a-only')
        const result = await applyCommandAsync(initial, { type: 'LoadRoot', root: ROOT_B })

        expect(result.roots.loaded.has(ROOT_B)).toBe(true)
        expect(result.graph.nodes[REMOTE_ID]).toBeDefined()
        expect(result.roots.folderTree).toHaveLength(2)
        expect(result.meta.revision).toBe(initial.meta.revision + 1)
    })

    it('emits rootsLoaded delta', async () => {
        const initial = loadSnapshot('050-two-roots-root-a-only')
        const { applyLoadRoot } = await import('../src/apply/roots')
        const { state, delta } = await applyLoadRoot(initial, { type: 'LoadRoot', root: ROOT_B })

        expect(delta.rootsLoaded).toEqual([ROOT_B])
        expect(delta.revision).toBe(initial.meta.revision + 1)
        expect(state.roots.loaded.has(ROOT_B)).toBe(true)
    })

    it('is idempotent — loading an already-loaded root is a no-op', async () => {
        const initial = loadSnapshot('050-two-roots-root-a-only')
        const stateAfterFirst = await applyCommandAsync(initial, { type: 'LoadRoot', root: ROOT_B })
        const stateAfterSecond = await applyCommandAsync(stateAfterFirst, { type: 'LoadRoot', root: ROOT_B })

        expect(stateAfterSecond.meta.revision).toBe(stateAfterFirst.meta.revision + 1)
        expect([...stateAfterSecond.roots.loaded].filter((r) => r === ROOT_B)).toHaveLength(1)
    })

    it('preserves root-a nodes (left-bias merge)', async () => {
        const initial = loadSnapshot('050-two-roots-root-a-only')
        const result = await applyCommandAsync(initial, { type: 'LoadRoot', root: ROOT_B })

        const rootANodes = Object.keys(result.graph.nodes)
            .filter((id) => id.startsWith('/tmp/graph-state-fixtures/root-a/'))
        expect(rootANodes.length).toBeGreaterThan(0)
    })
})
