import {cpSync, existsSync, mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import path from 'path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createEmptyGraph} from '../../src/pure/graph/createGraph'
import {createSearchBackend} from '../../src/search/index-backend'
import {SearchIndexNotFoundError, type SearchBackend} from '../../src/search/types'
import {setGraph} from '../../src/state/graph-store'
import {clearWatchFolderState, setProjectRootWatchedDirectory} from '../../src/state/watch-folder-store'
import {initGraphModel} from '../../src/types'
import {handleFSEventWithStateAndUISides} from '../../src/graph/handleFSEvent'
import {saveVaultConfigForDirectory} from '../../src/watch-folder/voicetree-config-io'

async function waitFor(assertion: () => Promise<void> | void, timeoutMs = 2000): Promise<void> {
    const deadline: number = Date.now() + timeoutMs
    let lastError: unknown

    while (Date.now() < deadline) {
        try {
            await assertion()
            return
        } catch (error: unknown) {
            lastError = error
            await new Promise(resolve => setTimeout(resolve, 25))
        }
    }

    throw lastError
}

function getHitNodePaths(results: readonly {nodePath: string}[]): string[] {
    return results.map(({nodePath}) => nodePath)
}

function getFixtureVaultPath(): string {
    return fileURLToPath(new URL('./fixtures/bf133-phase1/vault', import.meta.url))
}

describe('filesystem-event search index maintenance', () => {
    let appSupportPath: string
    let projectRootPath: string
    let tempRootPath: string
    let tempVaultPath: string
    let backend: SearchBackend

    beforeEach(async () => {
        tempRootPath = mkdtempSync(path.join(tmpdir(), 'vt-search-runtime-'))
        appSupportPath = path.join(tempRootPath, 'app-support')
        projectRootPath = path.join(tempRootPath, 'project')
        tempVaultPath = path.join(projectRootPath, 'vault')

        cpSync(getFixtureVaultPath(), tempVaultPath, {recursive: true})

        initGraphModel({appSupportPath})
        clearWatchFolderState()
        setProjectRootWatchedDirectory(projectRootPath)
        await saveVaultConfigForDirectory(projectRootPath, {
            writePath: tempVaultPath,
            readPaths: [],
        })
        setGraph(createEmptyGraph())

        backend = createSearchBackend()
    })

    afterEach(() => {
        clearWatchFolderState()
        setGraph(createEmptyGraph())
        rmSync(tempRootPath, {recursive: true, force: true})
    })

    it('updates an existing search index for add, change, and unlink filesystem events', async () => {
        await backend.buildIndex(tempVaultPath)

        const runtimeNodePath = path.join(tempVaultPath, 'runtime-note.md')
        const addedContent = '# Runtime Note\n\nThis node contains runtime-token for watcher indexing.\n'
        writeFileSync(runtimeNodePath, addedContent, 'utf8')

        handleFSEventWithStateAndUISides(
            {absolutePath: runtimeNodePath, content: addedContent, eventType: 'Added'},
            projectRootPath,
        )

        await waitFor(async () => {
            expect(getHitNodePaths(await backend.search(tempVaultPath, 'runtime-token', 10))).toContain(runtimeNodePath)
        })

        const changedContent = '# Runtime Note\n\nreplacement-token is the only remaining search term.\n'
        writeFileSync(runtimeNodePath, changedContent, 'utf8')

        handleFSEventWithStateAndUISides(
            {absolutePath: runtimeNodePath, content: changedContent, eventType: 'Changed'},
            projectRootPath,
        )

        await waitFor(async () => {
            expect(await backend.search(tempVaultPath, 'runtime-token', 10)).toHaveLength(0)
            expect(getHitNodePaths(await backend.search(tempVaultPath, 'replacement-token', 10))).toContain(runtimeNodePath)
        })

        rmSync(runtimeNodePath)
        handleFSEventWithStateAndUISides(
            {type: 'Delete', absolutePath: runtimeNodePath},
            projectRootPath,
        )

        await waitFor(async () => {
            expect(await backend.search(tempVaultPath, 'replacement-token', 10)).toHaveLength(0)
        })
    })

    it('does not create a search index from filesystem events before buildIndex runs', async () => {
        const runtimeNodePath = path.join(tempVaultPath, 'no-index-note.md')
        const content = '# No Index\n\nwatcher-token should not create an index on its own.\n'
        writeFileSync(runtimeNodePath, content, 'utf8')

        handleFSEventWithStateAndUISides(
            {absolutePath: runtimeNodePath, content, eventType: 'Added'},
            projectRootPath,
        )

        await waitFor(() => {
            expect(existsSync(path.join(tempVaultPath, '.vt-search', 'index.json'))).toBe(false)
        })

        await expect(backend.search(tempVaultPath, 'watcher-token', 10)).rejects.toBeInstanceOf(SearchIndexNotFoundError)
    })
})
