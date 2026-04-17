import { promises as fsp } from 'fs'
import path from 'path'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    clearLoadedRoots,
    dispatchLoadRoot,
    dispatchUnloadRoot,
    getLoadedRoots,
    isRootLoaded,
    subscribeLoadedRoots,
    type RootsDelta,
} from '../../src/state/loadedRootsStore'

const ROOT_A = '/tmp/loaded-roots-store-test/root-a'
const ROOT_B = '/tmp/loaded-roots-store-test/root-b'

async function setupFixtureDirs(): Promise<void> {
    await fsp.mkdir(ROOT_A, { recursive: true })
    await fsp.mkdir(ROOT_B, { recursive: true })
    await fsp.writeFile(path.join(ROOT_A, 'alpha.md'), '# alpha\n\nNote A.\n', 'utf8')
    await fsp.writeFile(path.join(ROOT_B, 'beta.md'), '# beta\n\nNote B.\n', 'utf8')
}

async function teardownFixtureDirs(): Promise<void> {
    await fsp.rm('/tmp/loaded-roots-store-test', { recursive: true, force: true })
}

beforeAll(setupFixtureDirs)
afterAll(teardownFixtureDirs)
beforeEach(() => { clearLoadedRoots() })

describe('loadedRootsStore — dispatchLoadRoot', () => {
    it('adds root to loaded set', async () => {
        await dispatchLoadRoot(ROOT_A)
        expect(getLoadedRoots().has(ROOT_A)).toBe(true)
    })

    it('is idempotent — double-load does not duplicate', async () => {
        await dispatchLoadRoot(ROOT_A)
        await dispatchLoadRoot(ROOT_A)
        const roots = [...getLoadedRoots()]
        expect(roots.filter(r => r === ROOT_A)).toHaveLength(1)
    })

    it('loads multiple independent roots', async () => {
        await dispatchLoadRoot(ROOT_A)
        await dispatchLoadRoot(ROOT_B)
        expect(getLoadedRoots().has(ROOT_A)).toBe(true)
        expect(getLoadedRoots().has(ROOT_B)).toBe(true)
        expect(getLoadedRoots().size).toBe(2)
    })

    it('notifies subscribers with rootsLoaded delta', async () => {
        const received: RootsDelta[] = []
        const unsub = subscribeLoadedRoots(d => received.push(d))

        await dispatchLoadRoot(ROOT_A)
        unsub()

        expect(received).toHaveLength(1)
        expect(received[0]!.rootsLoaded).toContain(ROOT_A)
    })

    it('does not notify when root already loaded (dedup)', async () => {
        await dispatchLoadRoot(ROOT_A)
        const received: RootsDelta[] = []
        const unsub = subscribeLoadedRoots(d => received.push(d))

        await dispatchLoadRoot(ROOT_A)
        unsub()

        expect(received).toHaveLength(0)
    })
})

describe('loadedRootsStore — dispatchUnloadRoot', () => {
    it('removes root from loaded set', async () => {
        await dispatchLoadRoot(ROOT_A)
        dispatchUnloadRoot(ROOT_A)
        expect(getLoadedRoots().has(ROOT_A)).toBe(false)
    })

    it('load/unload round-trip', async () => {
        await dispatchLoadRoot(ROOT_A)
        expect(isRootLoaded(ROOT_A)).toBe(true)
        dispatchUnloadRoot(ROOT_A)
        expect(isRootLoaded(ROOT_A)).toBe(false)
        expect(getLoadedRoots().size).toBe(0)
    })

    it('is a no-op when root is not loaded', () => {
        const before = getLoadedRoots().size
        dispatchUnloadRoot(ROOT_A)
        expect(getLoadedRoots().size).toBe(before)
    })

    it('notifies subscribers with rootsUnloaded delta and graph delta', async () => {
        await dispatchLoadRoot(ROOT_A)
        const received: RootsDelta[] = []
        const unsub = subscribeLoadedRoots(d => received.push(d))

        dispatchUnloadRoot(ROOT_A)
        unsub()

        expect(received).toHaveLength(1)
        expect(received[0]!.rootsUnloaded).toContain(ROOT_A)
        expect(received[0]!.graph).toBeDefined()
    })

    it('does not notify when root was not loaded', () => {
        const fn = vi.fn()
        const unsub = subscribeLoadedRoots(fn)
        dispatchUnloadRoot(ROOT_A)
        unsub()
        expect(fn).not.toHaveBeenCalled()
    })

    it('only removes the specified root, leaves others intact', async () => {
        await dispatchLoadRoot(ROOT_A)
        await dispatchLoadRoot(ROOT_B)
        dispatchUnloadRoot(ROOT_A)
        expect(isRootLoaded(ROOT_A)).toBe(false)
        expect(isRootLoaded(ROOT_B)).toBe(true)
    })
})

describe('loadedRootsStore — subscribeLoadedRoots', () => {
    it('unsubscribe stops notifications', async () => {
        const received: RootsDelta[] = []
        const unsub = subscribeLoadedRoots(d => received.push(d))

        await dispatchLoadRoot(ROOT_A)
        unsub()
        dispatchUnloadRoot(ROOT_A)

        expect(received).toHaveLength(1)
        expect(received[0]!.rootsLoaded).toBeDefined()
    })
})
