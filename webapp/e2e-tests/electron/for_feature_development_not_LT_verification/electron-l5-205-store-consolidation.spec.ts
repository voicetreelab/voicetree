import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import type { Core as CytoscapeCore } from 'cytoscape'
import type { ElectronAPI } from '@/shell/electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'

import {
    createFolderTestVault,
    waitForGraphLoaded,
} from './graph/folder-test-helpers'

const PROJECT_ROOT: string = path.resolve(process.cwd())

interface SerializedLiveState {
    collapseSet: string[]
    selection: string[]
}

interface DebugWindow {
    __vtDebug__?: {
        liveState?: () => SerializedLiveState
        applyLiveCommand?: (command: unknown) => Promise<unknown>
    }
    cytoscapeInstance?: CytoscapeCore
    electronAPI?: ElectronAPI
}

const test = base.extend<{
    electronApp: ElectronApplication
    appWindow: Page
    vaultPath: string
}>({
    vaultPath: async ({}, use): Promise<void> => {
        const tempDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-l5-205-vault-'))
        const vaultPath: string = await createFolderTestVault(tempDir)
        await use(vaultPath)
        await fs.rm(tempDir, { recursive: true, force: true })
    },

    electronApp: [async ({ vaultPath }, use): Promise<void> => {
        const tempUserDataPath: string = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-l5-205-test-'),
        )

        await fs.writeFile(
            path.join(tempUserDataPath, 'voicetree-config.json'),
            JSON.stringify(
                {
                    lastDirectory: vaultPath,
                    vaultConfig: {
                        [vaultPath]: {
                            writePath: vaultPath,
                            readPaths: [],
                        },
                    },
                },
                null,
                2,
            ),
            'utf8',
        )

        await fs.writeFile(
            path.join(tempUserDataPath, 'projects.json'),
            JSON.stringify(
                [
                    {
                        id: 'l5-205-store-consolidation',
                        path: vaultPath,
                        name: 'l5-205-store-consolidation',
                        type: 'folder',
                        lastOpened: Date.now(),
                        voicetreeInitialized: true,
                    },
                ],
                null,
                2,
            ),
            'utf8',
        )

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
            timeout: 15000,
        })

        await use(electronApp)

        try {
            const window: Page = await electronApp.firstWindow()
            await window.evaluate(async () => {
                const api = (window as unknown as DebugWindow).electronAPI
                if (api) await api.main.stopFileWatching()
            })
            await window.waitForTimeout(300)
        } catch {
            // Best-effort cleanup only.
        }

        await electronApp.close()
        await fs.rm(tempUserDataPath, { recursive: true, force: true })
    }, { timeout: 45000 }],

    appWindow: [async ({ electronApp }, use): Promise<void> => {
        const page: Page = await electronApp.firstWindow({ timeout: 15000 })

        page.on('console', (msg) => console.log(`BROWSER [${msg.type()}]:`, msg.text()))
        page.on('pageerror', (error) => console.error('PAGE ERROR:', error.message))

        await page.waitForLoadState('domcontentloaded')

        const projectButton = page.locator('button', { hasText: 'l5-205-store-consolidation' })
        await projectButton.waitFor({ timeout: 20000 })
        await projectButton.click()

        await waitForGraphLoaded(page, 3)
        await page.waitForFunction(
            () => {
                const win = window as unknown as DebugWindow
                return (
                    (win.cytoscapeInstance?.nodes().length ?? 0) >= 3
                    && typeof win.__vtDebug__?.liveState === 'function'
                    && typeof win.__vtDebug__?.applyLiveCommand === 'function'
                )
            },
            { timeout: 25000 },
        )
        await page.waitForTimeout(500)

        await use(page)
    }, { timeout: 45000 }],
})

test.describe('BF-L5-205 — renderer-canonical live state', () => {
    test('renderer collapseSet and selection round-trip into main snapshot over IPC', async ({ appWindow }) => {
        test.setTimeout(60000)

        const target: { folderId: string; nodeId: string } = await appWindow.evaluate(() => {
            const win = window as unknown as DebugWindow
            const cy = win.cytoscapeInstance
            if (!cy) throw new Error('No cytoscapeInstance')

            const folder = cy
                .nodes()
                .filter((node: import('cytoscape').NodeSingular) => node.data('isFolderNode'))
                .first()
            if (!folder.length) throw new Error('No folder node available for collapse test')

            const node = cy
                .nodes()
                .filter((candidate: import('cytoscape').NodeSingular) => {
                    if (candidate.data('isFolderNode') || candidate.data('isShadowNode')) return false
                    return !candidate.id().startsWith(folder.id())
                })
                .first()
            if (!node.length) throw new Error('No selectable node available outside collapsed folder')

            return { folderId: folder.id(), nodeId: node.id() }
        })

        const collapseRoundTrip: {
            renderer: SerializedLiveState
            main: SerializedLiveState
        } = await appWindow.evaluate(async (folderId: string) => {
            const win = window as unknown as DebugWindow
            await win.__vtDebug__!.applyLiveCommand!({ type: 'Collapse', folder: folderId })
            return {
                renderer: win.__vtDebug__!.liveState!(),
                main: await win.electronAPI!.main.getLiveStateSnapshot(),
            }
        }, target.folderId)

        expect(collapseRoundTrip.renderer.collapseSet).toContain(target.folderId)
        expect(collapseRoundTrip.main.collapseSet).toContain(target.folderId)

        const selectionRoundTrip: {
            renderer: SerializedLiveState
            main: SerializedLiveState
        } = await appWindow.evaluate(async (nodeId: string) => {
            const win = window as unknown as DebugWindow
            await win.__vtDebug__!.applyLiveCommand!({ type: 'Select', ids: [nodeId] })
            return {
                renderer: win.__vtDebug__!.liveState!(),
                main: await win.electronAPI!.main.getLiveStateSnapshot(),
            }
        }, target.nodeId)

        expect(selectionRoundTrip.renderer.selection).toContain(target.nodeId)
        expect(selectionRoundTrip.main.selection).toContain(target.nodeId)
    })
})
