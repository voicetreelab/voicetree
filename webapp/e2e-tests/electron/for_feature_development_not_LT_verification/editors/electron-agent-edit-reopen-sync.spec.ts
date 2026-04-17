/**
 * BUG REPRODUCTION: agent edits don't go through to UI on reopen
 *
 * SCENARIO (from user bug report):
 *  1. User opens a node (pins a floating editor) — editor shows original content
 *  2. User closes the pinned editor
 *  3. Agent-like external process writes new content to the node's .md file
 *  4. User re-opens the node
 *  → EXPECTED: new external content is shown in the freshly opened editor
 *  → ACTUAL: editor shows stale content (bug)
 *
 * The failure mode the user reports is that even "open/close" doesn't refresh,
 * which means the in-memory graph state (graph-store) is stale — not just an
 * already-open CM6 instance.
 *
 * ARCHITECTURE REMINDER:
 *  FS change → chokidar → handleFSEventWithStateAndUISides
 *    → isOurRecentDelta guard (skips our own echoes, but can false-positive
 *       on length-match collisions within 2% length tolerance)
 *    → applyGraphDeltaToMemState (updates in-memory graph-store)
 *    → broadcastGraphDeltaToUI (Cy node data)
 *    → onFloatingEditorUpdate (pushes into open editors)
 *
 * A newly-opened editor pulls its content via getNodeFromMainToUI, which reads
 * from the in-memory graph. If memory is stale, the reopen still shows the old
 * content.
 */

import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'
import type { Core as CytoscapeCore } from 'cytoscape'
import type { EditorView } from '@codemirror/view'

const PROJECT_ROOT: string = path.resolve(process.cwd())
const FIXTURE_VAULT_PATH: string = path.join(
    PROJECT_ROOT,
    'example_folder_fixtures',
    'example_small',
)

interface ExtendedWindow {
    cytoscapeInstance?: CytoscapeCore
    electronAPI?: {
        main: {
            stopFileWatching: () => Promise<{ success: boolean; error?: string }>
        }
    }
}

interface CodeMirrorElement extends HTMLElement {
    cmView?: { view: EditorView }
}

const test = base.extend<{
    electronApp: ElectronApplication
    appWindow: Page
}>({
    electronApp: [async ({}, use): Promise<void> => {
        const tempUserDataPath: string = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-agent-edit-reopen-'),
        )

        const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json')
        await fs.writeFile(configPath, JSON.stringify({
            lastDirectory: FIXTURE_VAULT_PATH,
            suffixes: { [FIXTURE_VAULT_PATH]: '' },
        }, null, 2), 'utf8')

        const projectsPath: string = path.join(tempUserDataPath, 'projects.json')
        await fs.writeFile(projectsPath, JSON.stringify([{
            id: 'test-agent-edit-reopen',
            path: FIXTURE_VAULT_PATH,
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
        await fs.rm(tempUserDataPath, { recursive: true, force: true })
    }, { timeout: 45000 }],

    appWindow: [async ({ electronApp }, use): Promise<void> => {
        const page: Page = await electronApp.firstWindow({ timeout: 15000 })

        page.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()))
        page.on('pageerror', error => console.error('PAGE ERROR:', error.message))

        await page.waitForLoadState('domcontentloaded')

        const projectButton = page.locator('button', { hasText: 'example_small' })
        await projectButton.waitFor({ timeout: 10000 })
        await projectButton.click()

        await page.waitForFunction(
            () => (window as unknown as ExtendedWindow).cytoscapeInstance,
            { timeout: 15000 },
        )
        await page.waitForTimeout(500)

        await use(page)
    }, { timeout: 45000 }],
})

test.describe('Agent edit → reopen sync', () => {
    test.afterEach(async ({ appWindow }): Promise<void> => {
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

    test('external write while editor is closed should show up on reopen', async ({ appWindow }): Promise<void> => {
        test.setTimeout(60000)

        await expect.poll(
            async () => appWindow.evaluate(
                () => ((window as unknown as ExtendedWindow).cytoscapeInstance?.nodes().length ?? 0),
            ),
            { message: 'waiting for graph to load', timeout: 15000 },
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
            : path.join(FIXTURE_VAULT_PATH, nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`)

        const originalContent: string = await fs.readFile(testFilePath, 'utf-8')
        const editorWindowId: string = `window-${nodeId}-editor`

        try {
            // 1. Open editor by tapping the node (pins a CM6 editor)
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
                { message: 'waiting for pinned editor to appear', timeout: 10000 },
            ).toBe(true)

            const escapedId: string = editorWindowId.replace(/[./]/g, '\\$&')
            await appWindow.waitForSelector(`#${escapedId} .cm-editor`, { timeout: 5000 })

            // 2. Close the editor (simulates user dismissing it before agent runs)
            await appWindow.evaluate((winId: string) => {
                const escapedWinId: string = CSS.escape(winId)
                const closeBtn = document.querySelector(
                    `#${escapedWinId} .traffic-light-close`,
                ) as HTMLButtonElement | null
                if (closeBtn) closeBtn.click()
            }, editorWindowId)

            await expect.poll(
                async () => appWindow.evaluate(
                    (winId: string) => document.getElementById(winId) !== null,
                    editorWindowId,
                ),
                { message: 'waiting for editor to be disposed', timeout: 5000 },
            ).toBe(false)

            // 3. Agent writes new content externally (AFTER editor is closed)
            const UNIQUE_MARKER: string = `AGENT_EDIT_REOPEN_${Date.now()}`
            const externalContent: string =
                `---\n---\n### Ongoing development for the VoiceTree website.\n\n` +
                `**${UNIQUE_MARKER}** - Simulated agent fs edit after editor was closed.\n`
            await fs.writeFile(testFilePath, externalContent, 'utf-8')

            // Allow chokidar + delta pipeline to run
            await appWindow.waitForTimeout(1500)

            // 4. Reopen the editor
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
                { message: 'waiting for reopened editor', timeout: 10000 },
            ).toBe(true)

            await appWindow.waitForSelector(`#${escapedId} .cm-editor`, { timeout: 5000 })

            // 5. Verify reopened editor contains the agent's marker
            const reopenedContent: string | null = await appWindow.evaluate((winId: string) => {
                const escapedWinId: string = CSS.escape(winId)
                const el = document.querySelector(`#${escapedWinId} .cm-content`) as HTMLElement | null
                if (!el) return null
                const cmView = (el as CodeMirrorElement).cmView?.view
                return cmView ? cmView.state.doc.toString() : null
            }, editorWindowId)

            expect(reopenedContent).not.toBeNull()
            expect(reopenedContent).toContain(UNIQUE_MARKER)
        } finally {
            await fs.writeFile(testFilePath, originalContent, 'utf-8')
            await appWindow.waitForTimeout(200)
        }
    })
})

export { test }
