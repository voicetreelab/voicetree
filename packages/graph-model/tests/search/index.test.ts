import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {cpSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {fileURLToPath} from 'node:url'
import path from 'path'
import {readdirSync} from 'fs'
import type {NodeSearchHit, SearchBackend} from '../../src/search/types'
import {SearchIndexNotFoundError} from '../../src/search/types'

type SearchBackendModule = {
    default?: unknown
    [key: string]: unknown
}

function isSearchBackend(value: unknown): value is SearchBackend {
    if (typeof value !== 'object' || value === null) {
        return false
    }

    return (
        typeof (value as SearchBackend).buildIndex === 'function'
        && typeof (value as SearchBackend).search === 'function'
        && typeof (value as SearchBackend).upsertNode === 'function'
        && typeof (value as SearchBackend).deleteNode === 'function'
    )
}

function instantiateBackend(candidate: unknown): SearchBackend | undefined {
    if (isSearchBackend(candidate)) {
        return candidate
    }

    if (typeof candidate !== 'function') {
        return undefined
    }

    try {
        const instance: unknown = candidate()
        if (isSearchBackend(instance)) {
            return instance
        }
    } catch {
        // allow both factories and classes
    }

    try {
        const instance: unknown = new (candidate as new () => unknown)()
        if (isSearchBackend(instance)) {
            return instance
        }
    } catch {
        // allow constructor-style exports with required params in a later implementation
    }

    return undefined
}

async function createSearchBackend(): Promise<SearchBackend> {
    const searchBackendModule = (await import('../../src/search/index-backend')) as SearchBackendModule
    const candidateKeys = [
        'default',
        'createSearchBackend',
        'createSearchIndexBackend',
        'createBackend',
        'buildBackend',
        'SearchBackendImpl',
        'IndexBackend',
    ]

    const candidates: unknown[] = [
        ...candidateKeys
            .map(key => searchBackendModule[key])
            .filter(Boolean),
        ...Object.values(searchBackendModule),
    ]

    for (const candidate of candidates) {
        const backend = instantiateBackend(candidate)
        if (backend) {
            return backend
        }
    }

    throw new Error('Unable to resolve a SearchBackend export from src/search/index-backend.ts')
}

function getFixtureVaultPath(): string {
    return fileURLToPath(new URL('./fixtures/bf133-phase1/vault', import.meta.url))
}

function getHitNodePaths(hits: readonly NodeSearchHit[]): string[] {
    return hits.map(({nodePath}) => nodePath)
}

describe('SearchBackend contract (BF-133)', () => {
    const fixtureVaultPath = getFixtureVaultPath()
    let tempVaultPath: string
    let backend: SearchBackend

    beforeEach(async () => {
        tempVaultPath = mkdtempSync(path.join(tmpdir(), 'vt-search-bf133-'))
        cpSync(fixtureVaultPath, tempVaultPath, {recursive: true})
        backend = await createSearchBackend()
    })

    afterEach(() => {
        rmSync(tempVaultPath, {recursive: true, force: true})
    })

    it('indexes full markdown content (body-only queries still discoverable)', async () => {
        await backend.buildIndex(tempVaultPath)

        const hits = await backend.search(tempVaultPath, 'full-body-anchor', 10)

        expect(hits).toHaveLength(1)
        expect(getHitNodePaths(hits)).toContain(path.join(tempVaultPath, 'body-only-match.md'))
    })

    it('throws SearchIndexNotFoundError when searching before an index is built', async () => {
        await expect(backend.search(tempVaultPath, 'anything', 10)).rejects.toBeInstanceOf(SearchIndexNotFoundError)
    })

    it('persists and reuses index artifacts across backend instances', async () => {
        await backend.buildIndex(tempVaultPath)

        const indexRoot = path.join(tempVaultPath, '.vt-search')
        expect(readdirSync(indexRoot)).toContain('index.json')

        const firstPass = await backend.search(tempVaultPath, 'full-body-anchor', 10)
        expect(firstPass).toHaveLength(1)

        const freshBackend = await createSearchBackend()
        const secondPass = await freshBackend.search(tempVaultPath, 'full-body-anchor', 10)

        expect(secondPass).toHaveLength(1)
        expect(getHitNodePaths(secondPass)).toEqual(getHitNodePaths(firstPass))
    })

    it('supports incremental upsert and delete operations for add/change/unlink flows', async () => {
        await backend.buildIndex(tempVaultPath)

        const newNodePath = path.join(tempVaultPath, 'change-me.md')
        const changeContent = '# Change Me\n\nThis node includes incremental-token for reindex checks.\n'

        await backend.upsertNode(tempVaultPath, newNodePath, changeContent, 'Change Me')
        expect(getHitNodePaths(await backend.search(tempVaultPath, 'incremental-token', 10))).toContain(newNodePath)

        const removedToken = '# Change Me\n\nToken removed after reindex check.\n'
        writeFileSync(newNodePath, removedToken, 'utf8')
        await backend.upsertNode(tempVaultPath, newNodePath, removedToken, 'Change Me')

        const postUpdateHits = await backend.search(tempVaultPath, 'incremental-token', 10)
        expect(postUpdateHits).toHaveLength(0)

        const deletedNodePath = path.join(tempVaultPath, 'legacy-signal.md')
        await backend.deleteNode(tempVaultPath, deletedNodePath)
        const postDeleteHits = await backend.search(tempVaultPath, 'legacy-signal', 10)
        expect(postDeleteHits).toHaveLength(0)
        expect(existsSync(deletedNodePath)).toBe(true)
    })
})
