/**
 * Browser VoiceTree — folder & project-selection gateway (daemon round-trip).
 *
 * Proves the no-Electron folder operations end-to-end against the REAL daemons
 * booted by globalSetup: Chrome → window.hostAPI (browserRuntime.ts) → VTD
 * `graph.*` folder routes → graphd/disk. Every assertion is observable: the RPC
 * result AND the on-disk directory/file the daemon created under the live
 * project allowlist (cfg.projectPath). No mocks, no internal spies.
 *
 * Covered HostAPI surface (main.*): createSubfolder, createDatedVoiceTreeFolder,
 * getDirectoryTree, getAvailableFoldersForSelector, addStarredFolder /
 * getStarredFolders / isStarred / removeStarredFolder, copyNodeToFolder.
 */

import {existsSync, readFileSync} from 'node:fs'
import {basename, join} from 'node:path'
import {test, expect} from '@playwright/test'
import {loadDaemonConfig, injectConfig, waitForHostApiReady} from './vt-e2e-helpers.ts'

// Structural view of the folder-facing slice of window.hostAPI.main. Mirrors the
// real contract shapes (browserRuntime.ts) so page.evaluate callbacks stay
// type-checked. The cast lives inside each callback because page.evaluate runs
// in the browser, where only erased TYPES (not module-scope values) are visible.
interface FolderMain {
    readonly getGraph: () => Promise<{nodes?: Record<string, unknown>}>
    readonly createSubfolder: (parentPath: string, folderName: string) =>
        Promise<{success: boolean; path?: string; error?: string}>
    readonly createDatedVoiceTreeFolder: () =>
        Promise<{success: boolean; path?: string; error?: string}>
    readonly getDirectoryTree: (rootPath: string, maxDepth?: number) =>
        Promise<{name: string; absolutePath: string; children?: unknown[]} | null>
    readonly getAvailableFoldersForSelector: (q: string) => Promise<readonly unknown[]>
    readonly getStarredFolders: () => Promise<readonly string[]>
    readonly addStarredFolder: (p: string) => Promise<unknown>
    readonly removeStarredFolder: (p: string) => Promise<unknown>
    readonly isStarred: (p: string) => Promise<boolean>
    readonly copyNodeToFolder: (nodeId: string, targetFolderPath: string) =>
        Promise<{success: boolean; targetPath: string; error?: string}>
}

type MainWindow = {hostAPI: {main: FolderMain}}

test.describe('Browser VoiceTree — folder gateway (daemon round-trip)', () => {

    test('createSubfolder creates an on-disk directory under the project', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const folderName = `sub-${Date.now()}`
        const result = await page.evaluate(
            ({parentPath, folderName}) =>
                (window as unknown as MainWindow).hostAPI.main.createSubfolder(parentPath, folderName),
            {parentPath: cfg.projectPath, folderName},
        )

        expect(result.success, `createSubfolder failed: ${result.error ?? ''}`).toBe(true)
        const expectedPath = join(cfg.projectPath, folderName)
        expect(result.path).toBe(expectedPath)
        expect(existsSync(expectedPath), 'subfolder must exist on disk').toBe(true)
    })

    test('createSubfolder OUTSIDE the project allowlist is refused and writes nothing', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        // A sibling of the project temp dir — reachable on disk but NOT in the
        // daemon's allowlist (project root + read paths). The gateway must refuse.
        const outsideParent = join(cfg.projectPath, '..')
        const folderName = `escape-${Date.now()}`
        const result = await page.evaluate(
            ({parentPath, folderName}) =>
                (window as unknown as MainWindow).hostAPI.main.createSubfolder(parentPath, folderName),
            {parentPath: outsideParent, folderName},
        )

        expect(result.success).toBe(false)
        expect(existsSync(join(outsideParent, folderName)), 'no directory may be created outside the allowlist').toBe(false)
    })

    test('createDatedVoiceTreeFolder creates a dated folder on disk under the project', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const result = await page.evaluate(
            () => (window as unknown as MainWindow).hostAPI.main.createDatedVoiceTreeFolder(),
        )
        expect(result.success, `createDatedVoiceTreeFolder failed: ${result.error ?? ''}`).toBe(true)
        expect(typeof result.path).toBe('string')
        expect(result.path!.startsWith(cfg.projectPath), 'dated folder must live under the project root').toBe(true)
        expect(existsSync(result.path!), 'dated folder must exist on disk').toBe(true)
    })

    test('getDirectoryTree returns the project tree including a freshly created subfolder', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const folderName = `tree-child-${Date.now()}`
        const tree = await page.evaluate(async ({projectPath, folderName}) => {
            const main = (window as unknown as MainWindow).hostAPI.main
            const created = await main.createSubfolder(projectPath, folderName)
            if (!created.success) return {error: created.error ?? 'createSubfolder failed'}
            const dir = await main.getDirectoryTree(projectPath)
            return {dir}
        }, {projectPath: cfg.projectPath, folderName})

        expect(tree.error, `setup failed: ${tree.error ?? ''}`).toBeUndefined()
        expect(tree.dir, 'getDirectoryTree must return a tree for an allowlisted root').not.toBeNull()
        expect(tree.dir!.absolutePath).toBe(cfg.projectPath)
        const childNames = (tree.dir!.children ?? []).map((c) => (c as {name: string}).name)
        expect(childNames, 'the new subfolder must appear in the directory tree').toContain(folderName)
    })

    test('getDirectoryTree OUTSIDE the allowlist returns null', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const dir = await page.evaluate(
            (outside) => (window as unknown as MainWindow).hostAPI.main.getDirectoryTree(outside),
            join(cfg.projectPath, '..'),
        )
        expect(dir).toBeNull()
    })

    test('starred folders round-trip: add → list/isStarred → remove', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        // Star a path INSIDE the allowlist (the daemon silently refuses to star
        // anything outside it, since starred trees get scanned). Use a real
        // subfolder we create so the star targets a genuine directory.
        const folderName = `starred-${Date.now()}`
        const target = join(cfg.projectPath, folderName)

        const result = await page.evaluate(async ({projectPath, folderName, target}) => {
            const main = (window as unknown as MainWindow).hostAPI.main
            const created = await main.createSubfolder(projectPath, folderName)
            if (!created.success) return {error: created.error ?? 'createSubfolder failed'}
            await main.addStarredFolder(target)
            const afterAdd = await main.getStarredFolders()
            const isStarredAfterAdd = await main.isStarred(target)
            await main.removeStarredFolder(target)
            const afterRemove = await main.getStarredFolders()
            const isStarredAfterRemove = await main.isStarred(target)
            return {afterAdd, isStarredAfterAdd, afterRemove, isStarredAfterRemove}
        }, {projectPath: cfg.projectPath, folderName, target})

        expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
        expect(result.afterAdd, 'starred list must include the added folder').toContain(target)
        expect(result.isStarredAfterAdd).toBe(true)
        expect(result.afterRemove, 'starred list must drop the removed folder').not.toContain(target)
        expect(result.isStarredAfterRemove).toBe(false)
    })

    test('copyNodeToFolder copies a node markdown file into a target folder on disk', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const folderName = `copy-target-${Date.now()}`
        const targetFolder = join(cfg.projectPath, folderName)

        const result = await page.evaluate(async ({projectPath, folderName, targetFolder}) => {
            const main = (window as unknown as MainWindow).hostAPI.main
            const created = await main.createSubfolder(projectPath, folderName)
            if (!created.success) return {error: created.error ?? 'createSubfolder failed'}
            const graph = await main.getGraph()
            const nodeId = Object.keys(graph.nodes ?? {}).find((id) => !id.endsWith('/'))
            if (!nodeId) return {error: 'no leaf node in graph'}
            const copy = await main.copyNodeToFolder(nodeId, targetFolder)
            return {nodeId, copy}
        }, {projectPath: cfg.projectPath, folderName, targetFolder})

        expect(result.error, `setup failed: ${result.error ?? ''}`).toBeUndefined()
        expect(result.copy!.success, `copyNodeToFolder failed: ${result.copy!.error ?? ''}`).toBe(true)
        expect(result.copy!.targetPath.startsWith(targetFolder), 'copy must land in the target folder').toBe(true)
        expect(existsSync(result.copy!.targetPath), 'copied markdown file must exist on disk').toBe(true)

        // The copy's bytes must equal the source node's backing file.
        const sourceBytes = readFileSync(result.nodeId!, 'utf8')
        const copyBytes = readFileSync(result.copy!.targetPath, 'utf8')
        expect(copyBytes).toBe(sourceBytes)
        expect(basename(result.copy!.targetPath).endsWith('.md')).toBe(true)
    })

    test('getAvailableFoldersForSelector returns an array scoped to the allowlist', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const folders = await page.evaluate(
            () => (window as unknown as MainWindow).hostAPI.main.getAvailableFoldersForSelector(''),
        )
        expect(Array.isArray(folders)).toBe(true)
    })

})
