// Playwright test extension for the agent-storm-perf spec. Extracted to keep
// the spec file under the 500-line cap. Side effects live here (temp dir
// allocation, Electron launch/teardown, daemon URL discovery via the renderer
// accessor) — the spec body itself stays a flat sequence of measurement +
// assertion steps.

import { test as base, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import * as os from 'node:os'

import { generateProjectOnDisk, type ProjectLayout } from '@vt/perf-fixtures'
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { terminalRuntimeSurface as agentRuntime } from '@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts'

import {
    parseStormArgs,
    readDaemonUrl,
    resolveGraphDaemonNodeBin,
    type E2EArgs,
} from './stormHelpers'

export interface StormFixtures {
    electronApp: ElectronApplication
    appWindow: Page
    args: E2EArgs
    projectPath: string
    voicetreeHomePath: string
    projectLayout: ProjectLayout
    daemonUrl: string
    mainInspectPort: number
}

export function makeStormTest(projectRoot: string): ReturnType<typeof base.extend<StormFixtures>> {
    return base.extend<StormFixtures>({
        args: async ({}, use) => {
            await use(parseStormArgs())
        },

        projectPath: async ({}, use) => {
            // Project sits inside a per-run temp project dir so the app's project
            // picker has a reasonable name.
            const tempProjectRoot = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-storm-project-'))
            const project = path.join(tempProjectRoot, 'perf-project')
            await use(project)
            // Cleanup happens in `electronApp` teardown so the order is
            // electron-close → project-rm → orphan-reap.
        },

        voicetreeHomePath: async ({}, use) => {
            const voicetreeHome = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-storm-app-'))
            await use(voicetreeHome)
        },

        projectLayout: async ({ projectPath, args }, use) => {
            if (args.projectSeedNodeCount < args.agents) {
                throw new Error(
                    `PERF_E2E_PROJECT_SEED_NODES (${args.projectSeedNodeCount}) < PERF_E2E_AGENTS (${args.agents}); `
                    + `each agent needs a distinct first-cluster anchor`,
                )
            }
            const layout = generateProjectOnDisk(projectPath, args.projectSeedNodeCount)
            console.log(`[E2E Storm] seeded project with ${layout.nodes.length} nodes at ${projectPath}`)
            await use(layout)
        },

        electronApp: async ({ args, projectPath, voicetreeHomePath, projectLayout: _projectLayout }, use) => {
            // Seed projects.json so the picker shows the project project. We point
            // opens straight into graph view on click.
            const projectsPath = path.join(voicetreeHomePath, 'projects.json')
            const projectName = path.basename(path.dirname(projectPath))
            await fs.writeFile(
                projectsPath,
                JSON.stringify([{
                    id: 'e2e-storm-perf-project',
                    path: path.dirname(projectPath),
                    name: projectName,
                    type: 'folder',
                    lastOpened: Date.now(),
                }], null, 2),
                'utf8',
            )

            const configPath = path.join(voicetreeHomePath, 'voicetree-config.json')
            await fs.writeFile(
                configPath,
                JSON.stringify({
                    lastDirectory: path.dirname(projectPath),
                    projectConfig: {
                        [path.dirname(projectPath)]: {
                            writeFolderPath: projectPath,
                            readPaths: [],
                        },
                    },
                }, null, 2),
                'utf8',
            )

            const INSPECT_PORT = 9234
            const electronApp = await electron.launch({
                args: [
                    `--inspect=${INSPECT_PORT}`,
                    path.join(projectRoot, 'dist-electron/main/index.js'),
                    `--user-data-dir=${voicetreeHomePath}`,
                ],
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    HEADLESS_TEST: process.env.HEADLESS_TEST ?? '1',
                    MINIMIZE_TEST: process.env.MINIMIZE_TEST ?? '1',
                    VOICETREE_PERSIST_STATE: '1',
                    VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
                    VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(projectRoot),
                },
                timeout: 30_000,
            })

            // Surface [load-timing] from the bundled main.
            const mainStdout = electronApp.process().stdout
            if (mainStdout) {
                mainStdout.on('data', (chunk: Buffer) => {
                    const text = chunk.toString()
                    for (const line of text.split('\n')) {
                        if (line.startsWith('[load-timing]') || line.includes('[e2e-storm]')) {
                            console.log(line)
                        }
                    }
                })
            }

            await use(electronApp)

            // ─── teardown ─────────────────────────────────────────────────────
            try {
                const win = await electronApp.firstWindow()
                await win.evaluate(async () => {
                    const api = (window as unknown as {
                        electronAPI?: { main?: { stopFileWatching?: () => Promise<void> } }
                    }).electronAPI
                    if (api?.main?.stopFileWatching) await api.main.stopFileWatching()
                })
                await win.waitForTimeout(300)
            } catch {
                // ignore
            }
            await electronApp.close()

            // tear down agent-runtime tmux sessions before removing project dir
            try { agentRuntime.getTerminalManager().cleanup() } catch { /* may be unconfigured if early failure */ }

            if (!args.keepArtifacts) {
                await fs.rm(path.dirname(projectPath), { recursive: true, force: true })
                await fs.rm(voicetreeHomePath, { recursive: true, force: true })
            } else {
                console.log(`[E2E Storm] artifacts kept: project=${projectPath} voicetreeHome=${voicetreeHomePath}`)
            }

            const reaped = killOrphanVtGraphdDaemons()
            if (reaped.killed.length > 0) {
                console.log('[E2E Storm] Reaped orphan vt-graphd daemons', reaped.killed)
            }
        },

        appWindow: async ({ electronApp }, use) => {
            const win = await electronApp.firstWindow({ timeout: 30_000 })
            win.on('console', (msg) => {
                const t = msg.type()
                if (t === 'error' || t === 'warning') console.log(`BROWSER [${t}]:`, msg.text())
            })
            win.on('pageerror', (err) => console.error('PAGE ERROR:', err.message))
            await win.waitForLoadState('domcontentloaded')
            await use(win)
        },

        daemonUrl: async ({ projectPath, appWindow }, use) => {
            // Click into the seeded project so the app opens the project and
            // binds its in-process HTTP daemon. We target by `data-testid`
            // rather than visible text — the text-match approach is brittle
            // when the temp project name happens to span the layout.
            await appWindow.waitForSelector('text=Voicetree', { timeout: 30_000 })
            const projectName = path.basename(path.dirname(projectPath))
            const projectBtn = appWindow.locator('button[data-testid="saved-project-button"]').first()
            await projectBtn.waitFor({ state: 'visible', timeout: 30_000 })
            await projectBtn.click({ timeout: 60_000 })
            console.log(`[E2E Storm] Clicked project '${projectName}' to enter graph view`)

            const url = await readDaemonUrl(appWindow, 90_000)
            console.log(`[E2E Storm] discovered daemon URL=${url}`)
            await use(url)
        },

        mainInspectPort: async ({}, use) => {
            // Must match the value passed into --inspect= above. Hardcoded here
            // mirrors the existing CDP perf spec; the only consumer of this value
            // is the main-process CDP profiler, which polls /json/list on the port.
            await use(9234)
        },
    })
}
