import { test as base, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import * as os from 'node:os'

import { generateVaultOnDisk, type VaultLayout } from '@vt/perf-fixtures'
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { agentRuntime } from '@vt/agent-runtime'

import { parseArgs, type E2EArgs } from './args'
import { readMcpPort } from './mcp'
import { PROJECT_ROOT, resolveGraphDaemonNodeBin } from './nativeGraphDaemon'

export interface StormFixtures {
    electronApp: ElectronApplication
    appWindow: Page
    args: E2EArgs
    vaultPath: string
    appSupportPath: string
    vaultLayout: VaultLayout
    mcpPort: number
    mainInspectPort: number
}

export const test = base.extend<StormFixtures>({
    args: async ({}, use) => {
        await use(parseArgs())
    },

    vaultPath: async ({}, use) => {
        // Vault sits inside a per-run temp project dir so the app's project
        // picker has a reasonable name.
        const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-storm-project-'))
        const vault = path.join(projectRoot, 'perf-vault')
        await use(vault)
        // Cleanup happens in `electronApp` teardown so the order is
        // electron-close -> vault-rm -> orphan-reap.
    },

    appSupportPath: async ({}, use) => {
        const appSupport = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-storm-app-'))
        await use(appSupport)
    },

    vaultLayout: async ({ vaultPath, args }, use) => {
        if (args.vaultSeedNodeCount < args.agents) {
            throw new Error(
                `PERF_E2E_VAULT_SEED_NODES (${args.vaultSeedNodeCount}) < PERF_E2E_AGENTS (${args.agents}); `
                + `each agent needs a distinct first-cluster anchor`,
            )
        }
        const layout = generateVaultOnDisk(vaultPath, args.vaultSeedNodeCount)
        console.log(`[E2E Storm] seeded vault with ${layout.nodes.length} nodes at ${vaultPath}`)
        await use(layout)
    },

    electronApp: async ({ args, vaultPath, appSupportPath, vaultLayout: _vaultLayout }, use) => {
        // Seed projects.json so the picker shows the vault project. We point
        // `path` AND `voicetreeInitialized: true` at the vault so the app
        // opens straight into graph view on click.
        const projectsPath = path.join(appSupportPath, 'projects.json')
        const projectName = path.basename(path.dirname(vaultPath))
        await fs.writeFile(
            projectsPath,
            JSON.stringify([{
                id: 'e2e-storm-perf-project',
                path: path.dirname(vaultPath),
                name: projectName,
                type: 'folder',
                lastOpened: Date.now(),
                voicetreeInitialized: true,
            }], null, 2),
            'utf8',
        )

        const configPath = path.join(appSupportPath, 'voicetree-config.json')
        await fs.writeFile(
            configPath,
            JSON.stringify({
                lastDirectory: path.dirname(vaultPath),
                vaultConfig: {
                    [path.dirname(vaultPath)]: {
                        writePath: vaultPath,
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
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${appSupportPath}`,
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: process.env.HEADLESS_TEST ?? '1',
                MINIMIZE_TEST: process.env.MINIMIZE_TEST ?? '1',
                VOICETREE_PERSIST_STATE: '1',
                VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
                VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
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

        // tear down agent-runtime tmux sessions before removing vault dir
        try { agentRuntime.getTerminalManager().cleanup() } catch { /* may be unconfigured if early failure */ }

        if (!args.keepArtifacts) {
            await fs.rm(path.dirname(vaultPath), { recursive: true, force: true })
            await fs.rm(appSupportPath, { recursive: true, force: true })
        } else {
            console.log(`[E2E Storm] artifacts kept: vault=${vaultPath} appSupport=${appSupportPath}`)
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

    mcpPort: async ({ vaultPath, appWindow }, use) => {
        // Click into the seeded project so the app opens the vault and writes
        // .mcp.json. We target by `data-testid` rather than visible text - the
        // text-match approach is brittle when the temp project name happens
        // to span the layout.
        await appWindow.waitForSelector('text=Voicetree', { timeout: 30_000 })
        const projectName = path.basename(path.dirname(vaultPath))
        const projectBtn = appWindow.locator('button[data-testid="saved-project-button"]').first()
        await projectBtn.waitFor({ state: 'visible', timeout: 30_000 })
        await projectBtn.click({ timeout: 60_000 })
        console.log(`[E2E Storm] Clicked project '${projectName}' to enter graph view`)

        const mcpJsonPath = path.join(vaultPath, '.mcp.json')
        const port = await readMcpPort(mcpJsonPath, 90_000)
        console.log(`[E2E Storm] discovered MCP port=${port} from ${mcpJsonPath}`)
        await use(port)
    },

    mainInspectPort: async ({}, use) => {
        // Must match the value passed into --inspect= above. Hardcoded here
        // mirrors the existing CDP perf spec; the only consumer of this value
        // is the main-process CDP profiler, which polls /json/list on the port.
        await use(9234)
    },
})
