import { promises as fsp } from 'fs'
import path from 'path'

import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest'
import * as E from 'fp-ts/lib/Either.js'

import { buildGraphFromFiles, toAbsolutePath, type DirectoryEntry } from '@vt/graph-model'
import { applyCommandAsync } from '../src/applyCommand'
import { loadSnapshot } from '../src/fixtures'
import { configureRootIO, clearRootIOForTests } from '../src/rootIO'

const ROOT_B = '/tmp/graph-state-fixtures/root-b'
const REMOTE_ID = `${ROOT_B}/remote.md`

async function readMarkdownFiles(rootPath: string): Promise<readonly { readonly absolutePath: string; readonly content: string }[]> {
    const files: { absolutePath: string; content: string }[] = []
    async function walk(dirPath: string): Promise<void> {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true })
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith('.')) continue
            const abs = path.join(dirPath, entry.name)
            if (entry.isDirectory()) { await walk(abs); continue }
            if (entry.isFile() && entry.name.endsWith('.md')) {
                files.push({ absolutePath: abs, content: await fsp.readFile(abs, 'utf8') })
            }
        }
    }
    await walk(rootPath)
    return files
}

async function getDirectoryTree(rootPath: string): Promise<DirectoryEntry> {
    const abs = path.resolve(rootPath)
    const stats = await fsp.stat(abs)
    if (!stats.isDirectory()) {
        return { absolutePath: toAbsolutePath(abs), name: path.basename(abs), isDirectory: false }
    }
    const entries = await fsp.readdir(abs, { withFileTypes: true })
    const children = await Promise.all(
        entries.filter(e => !e.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))
            .map(e => getDirectoryTree(path.join(abs, e.name))),
    )
    return { absolutePath: toAbsolutePath(abs), name: path.basename(abs), isDirectory: true, children }
}

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
    beforeAll(async () => {
        configureRootIO({
            getDirectoryTree,
            loadGraphFromDisk: async (vaultPaths) => {
                try {
                    const filesByVault = await Promise.all(vaultPaths.map(p => readMarkdownFiles(path.resolve(p))))
                    return E.right(buildGraphFromFiles(filesByVault.flat()))
                } catch (error) {
                    return E.left(error)
                }
            },
        })
        await setupRootB()
    })
    afterAll(async () => {
        await teardownRootB()
        clearRootIOForTests()
    })

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
