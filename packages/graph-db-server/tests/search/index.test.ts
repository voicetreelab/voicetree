import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {cpSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {fileURLToPath} from 'node:url'
import path from 'path'
import {readdirSync} from 'fs'
import {buildIndex, deleteNode, search, upsertNode} from '../../src/search/index-backend'
import type {NodeSearchHit} from '../../src/search/types'
import {SearchIndexNotFoundError} from '../../src/search/types'

function getFixtureVaultPath(): string {
    return fileURLToPath(new URL('./fixtures/bf133-phase1/vault', import.meta.url))
}

function getHitNodePaths(hits: readonly NodeSearchHit[]): string[] {
    return hits.map(({nodePath}) => nodePath)
}

describe('SearchBackend contract (BF-133)', () => {
    const fixtureVaultPath = getFixtureVaultPath()
    let tempVaultPath: string

    beforeEach(() => {
        tempVaultPath = mkdtempSync(path.join(tmpdir(), 'vt-search-bf133-'))
        cpSync(fixtureVaultPath, tempVaultPath, {recursive: true})
    })

    afterEach(() => {
        rmSync(tempVaultPath, {recursive: true, force: true})
    })

    it('indexes full markdown content (body-only queries still discoverable)', async () => {
        await buildIndex(tempVaultPath)

        const hits = await search(tempVaultPath, 'full-body-anchor', 10)

        expect(hits).toHaveLength(1)
        expect(getHitNodePaths(hits)).toContain(path.join(tempVaultPath, 'body-only-match.md'))
    })

    it('throws SearchIndexNotFoundError when searching before an index is built', async () => {
        await expect(search(tempVaultPath, 'anything', 10)).rejects.toBeInstanceOf(SearchIndexNotFoundError)
    })

    it('persists and reuses index artifacts across backend instances', async () => {
        await buildIndex(tempVaultPath)

        const indexRoot = path.join(tempVaultPath, '.vt-search')
        expect(readdirSync(indexRoot)).toContain('kg.db')

        const firstPass = await search(tempVaultPath, 'full-body-anchor', 10)
        expect(firstPass).toHaveLength(1)

        const secondPass = await search(tempVaultPath, 'full-body-anchor', 10)

        expect(secondPass).toHaveLength(1)
        expect(getHitNodePaths(secondPass)).toEqual(getHitNodePaths(firstPass))
    })

    it('supports incremental upsert and delete operations for add/change/unlink flows', async () => {
        await buildIndex(tempVaultPath)

        const newNodePath = path.join(tempVaultPath, 'change-me.md')
        const changeContent = '# Change Me\n\nThis node includes incremental-token for reindex checks.\n'

        await upsertNode(tempVaultPath, newNodePath, changeContent, 'Change Me')
        expect(getHitNodePaths(await search(tempVaultPath, 'incremental-token', 10))).toContain(newNodePath)

        const removedToken = '# Change Me\n\nToken removed after reindex check.\n'
        writeFileSync(newNodePath, removedToken, 'utf8')
        await upsertNode(tempVaultPath, newNodePath, removedToken, 'Change Me')

        const postUpdateHits = await search(tempVaultPath, 'incremental-token', 10)
        expect(postUpdateHits).toHaveLength(0)

        const deletedNodePath = path.join(tempVaultPath, 'legacy-signal.md')
        await deleteNode(tempVaultPath, deletedNodePath)
        const postDeleteHits = await search(tempVaultPath, 'legacy-signal', 10)
        expect(postDeleteHits).toHaveLength(0)
        expect(existsSync(deletedNodePath)).toBe(true)
    })
})
