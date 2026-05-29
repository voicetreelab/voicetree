/**
 * BUG REPRODUCTION (cold-start variant — matches user's actual report):
 *
 *  User: "this happens even if i haven't made changes at all to the node"
 *
 *  SCENARIO:
 *  1. App boots, graph loads.
 *  2. User does NOT tap or modify the target node.
 *  3. Agent-like external process writes new content to the node's .md file.
 *  4. User taps the node for the first time.
 *  → EXPECTED: editor shows the agent's new content; graph-store has it too.
 *  → ACTUAL (the bug): one or both show stale content.
 *
 *  The companion test `electron-agent-edit-reopen-sync.spec.ts` opens then
 *  closes the editor before the external write. That sequence does NOT match
 *  the user's report (no in-app interaction was supposed to happen first).
 *  This test removes that priming.
 *
 *  ASSERTION LAYERS (per Ari's red-team gap analysis):
 *   Layer 1: graph-store memory via window.electronAPI.main.getNode(nodeId)
 *   Layer 2: visible editor doc via cmView.state.doc.toString()
 *  If only Layer 2 fails, it's a renderer/IPC bug; if Layer 1 fails, it's a
 *  pipeline (chokidar/handleFSEvent/applyGraphDelta) bug.
 */

import {test as base, expect, _electron as electron} from '@playwright/test'
import type {ElectronApplication, Page} from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'
import type {Core as CytoscapeCore} from 'cytoscape'
import type {EditorView} from '@codemirror/view'

const PROJECT_ROOT: string = path.resolve(process.cwd())
const FIXTURE_PROJECT_PATH: string = path.join(
    PROJECT_ROOT,
    'example_folder_fixtures',
    'example_small',
)

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore
    electronAPI?: {
        main: {
            stopFileWatching: () => Promise<{success: boolean; error?: string}>
            getNode: (nodeId: string) => Promise<{contentWithoutYamlOrLinks?: string} | undefined>
        }
    }
}

interface CodeMirrorElement extends HTMLElement {
    cmView?: {view: EditorView}
}

const test = base.extend<{
    electronApp: ElectronApplication
    appWindow: Page
}>({
    electronApp: [async ({}, use): Promise<void> => {
        const tempUserDataPath: string = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-agent-cold-start-'),
        )

        const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json')
        await fs.writeFile(configPath, JSON.stringify({
            lastDirectory: FIXTURE_PROJECT_PATH,
            suffixes: {[FIXTURE_PROJECT_PATH]: ''},
        }, null, 2), 'utf8')

        const projectsPath: string = path.join(tempUserDataPath, 'projects.json')
        await fs.writeFile(projectsPath, JSON.stringify([{
            id: 'test-agent-cold-start',
            path: FIXTURE_PROJECT_PATH,
            name: 'example_small',
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true,
        }], null, 2), 'utf8')

        const electronApp: ElectronApplication = await electron.launch({
            args: [
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${tempUserDataPath}`,
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: '1',
                MINIMIZE_TEST: '1',
                VOICETREE_PERSIST_STATE: '1',
            },
            timeout: 10000,
        })

        await use(electronApp)

        try {
            const page: Page = await electronApp.firstWindow()
            await page.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI
                if (api) await api.main.stopFileWatching()
            })
            await page.waitForTimeout(300)
        } catch {
            console.log('Note: Could not stop file watching during cleanup')
        }

        await electronApp.close()
        await fs.rm(tempUserDataPath, {recursive: true, force: true})
    }, {timeout: 45000}],

    appWindow: [async ({electronApp}, use): Promise<void> => {
        const page: Page = await electronApp.firstWindow({timeout: 15000})

        page.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()))
        page.on('pageerror', error => console.error('PAGE ERROR:', error.message))

        await page.waitForLoadState('domcontentloaded')

        const projectButton = page.locator('button', {hasText: 'example_small'})
        await projectButton.waitFor({timeout: 10000})
        await projectButton.click()

        await page.waitForFunction(
            () => (window as unknown as ExtendedWindow).cytoscapeInstance,
            {timeout: 15000},
        )
        await page.waitForTimeout(500)

        await use(page)
    }, {timeout: 45000}],
})

test.describe('Cold-start: agent edit before any in-app interaction', () => {
    test.afterEach(async ({appWindow}): Promise<void> => {
        try {
            await appWindow.evaluate(async () => {
                const api = (window as unknown as ExtendedWindow).electronAPI
                if (api) await api.main.stopFileWatching()
            })
            await appWindow.waitForTimeout(200)
        } catch {
            // Window might already be closed
        }
    })

    test('external write to never-tapped node should appear in graph-store AND editor on first tap', async ({appWindow}): Promise<void> => {
        test.setTimeout(60000)

        // 0. Wait for graph to load — but DO NOT tap or interact with the target node
        await expect.poll(
            async () => appWindow.evaluate(
                () => ((window as unknown as ExtendedWindow).cytoscapeInstance?.nodes().length ?? 0),
            ),
            {message: 'waiting for graph to load', timeout: 15000},
        ).toBeGreaterThan(0)

        const TARGET_LABEL: string = 'Ongoing development for the VoiceTree website.'

        const nodeId: string = await appWindow.evaluate((label: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance
            if (!cy) throw new Error('Cytoscape not initialized')
            const nodes = cy.nodes()
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].data('label') === label) return nodes[i].id()
            }
            throw new Error(`Node "${label}" not found`)
        }, TARGET_LABEL)

        const testFilePath: string = path.isAbsolute(nodeId)
            ? nodeId
            : path.join(FIXTURE_PROJECT_PATH, nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)

        const originalContent: string = await fs.readFile(testFilePath, 'utf-8')
        const editorWindowId: string = `window-${nodeId}-editor`

        try {
            // 1. AGENT WRITES — node has never been tapped, no in-app delta exists
            const UNIQUE_MARKER: string = `COLD_START_AGENT_${Date.now()}`
            const externalContent: string =
                `---\n---\n### Ongoing development for the VoiceTree website.\n\n` +
                `**${UNIQUE_MARKER}** - Agent fs edit on a never-tapped node.\n`
            await fs.writeFile(testFilePath, externalContent, 'utf-8')

            // 2. Allow chokidar + delta pipeline to run
            await appWindow.waitForTimeout(2000)

            // 3. LAYER 1 — assert graph-store memory has been updated
            const storedContent: string | undefined = await appWindow.evaluate(async (nId: string) => {
                const api = (window as unknown as ExtendedWindow).electronAPI
                if (!api) throw new Error('electronAPI missing')
                const node = await api.main.getNode(nId)
                return node?.contentWithoutYamlOrLinks
            }, nodeId)

            expect(storedContent, 'Layer 1: graph-store should contain the agent\'s marker').toBeDefined()
            expect(storedContent, 'Layer 1: graph-store should contain the agent\'s marker').toContain(UNIQUE_MARKER)

            // 4. NOW tap the node for the first time
            await appWindow.evaluate((nId: string) => {
                const cy = (window as unknown as ExtendedWindow).cytoscapeInstance
                if (!cy) throw new Error('Cytoscape not initialized')
                cy.getElementById(nId).trigger('tap')
            }, nodeId)

            await expect.poll(
                async () => appWindow.evaluate(
                    (winId: string) => document.getElementById(winId) !== null,
                    editorWindowId,
                ),
                {message: 'waiting for first-time editor to appear', timeout: 10000},
            ).toBe(true)

            const escapedId: string = editorWindowId.replace(/[./]/g, '\\$&')
            await appWindow.waitForSelector(`#${escapedId} .cm-editor`, {timeout: 5000})

            // 5. LAYER 2 — assert visible CM6 doc reflects the agent's content
            const editorContent: string | null = await appWindow.evaluate((winId: string) => {
                const escapedWinId: string = CSS.escape(winId)
                const el = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null
                if (!el) return null
                const cmView = (el as CodeMirrorElement).cmView?.view
                return cmView ? cmView.state.doc.toString() : null
            }, editorWindowId)

            expect(editorContent, 'Layer 2: editor should show agent\'s marker on first tap').not.toBeNull()
            expect(editorContent, 'Layer 2: editor should show agent\'s marker on first tap').toContain(UNIQUE_MARKER)
        } finally {
            await fs.writeFile(testFilePath, originalContent, 'utf-8')
            await appWindow.waitForTimeout(200)
        }
    })

    // NOTE: The H3 (context-node bypass) regression is covered end-to-end by the
    // vitest integration test at packages/libraries/graph-model/tests/graph/context-node-external-edit.test.ts
    // which exercises the same chokidar→handleFSEvent→graph-store pipeline used in
    // production, just without the Playwright/IPC layer. We tried adding it here too
    // but priming `markRecentDelta` from the playwright main-process context requires
    // dynamic-import support that the bundled main doesn't provide.

    test('two consecutive external writes — second one wins in graph-store', async ({appWindow}): Promise<void> => {
        test.setTimeout(60000)

        await expect.poll(
            async () => appWindow.evaluate(
                () => ((window as unknown as ExtendedWindow).cytoscapeInstance?.nodes().length ?? 0),
            ),
            {message: 'waiting for graph to load', timeout: 15000},
        ).toBeGreaterThan(0)

        const TARGET_LABEL: string = 'Ongoing development for the VoiceTree website.'

        const nodeId: string = await appWindow.evaluate((label: string) => {
            const cy = (window as unknown as ExtendedWindow).cytoscapeInstance
            if (!cy) throw new Error('Cytoscape not initialized')
            const nodes = cy.nodes()
            for (let i = 0; i < nodes.length; i++) {
                if (nodes[i].data('label') === label) return nodes[i].id()
            }
            throw new Error(`Node "${label}" not found`)
        }, TARGET_LABEL)

        const testFilePath: string = path.isAbsolute(nodeId)
            ? nodeId
            : path.join(FIXTURE_PROJECT_PATH, nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)

        const originalContent: string = await fs.readFile(testFilePath, 'utf-8')

        try {
            const FIRST_MARKER: string = `FIRST_WRITE_${Date.now()}`
            const SECOND_MARKER: string = `SECOND_WRITE_${Date.now()}`

            await fs.writeFile(
                testFilePath,
                `---\n---\n### Ongoing development for the VoiceTree website.\n\n**${FIRST_MARKER}**\n`,
                'utf-8',
            )
            await appWindow.waitForTimeout(800)

            await fs.writeFile(
                testFilePath,
                `---\n---\n### Ongoing development for the VoiceTree website.\n\n**${SECOND_MARKER}**\n`,
                'utf-8',
            )
            await appWindow.waitForTimeout(2000)

            const storedContent: string | undefined = await appWindow.evaluate(async (nId: string) => {
                const api = (window as unknown as ExtendedWindow).electronAPI
                if (!api) throw new Error('electronAPI missing')
                const node = await api.main.getNode(nId)
                return node?.contentWithoutYamlOrLinks
            }, nodeId)

            expect(storedContent, 'graph-store should reflect the SECOND write').toBeDefined()
            expect(storedContent).toContain(SECOND_MARKER)
            expect(storedContent).not.toContain(FIRST_MARKER)
        } finally {
            await fs.writeFile(testFilePath, originalContent, 'utf-8')
            await appWindow.waitForTimeout(200)
        }
    })
})

export {test}
