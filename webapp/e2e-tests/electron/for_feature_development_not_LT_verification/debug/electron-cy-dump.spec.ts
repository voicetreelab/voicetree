/**
 * BEHAVIORAL SPEC — BF-DBG-204b window.__vtDebug__.cy() dump helper
 *
 * Verifies that page.evaluate(() => window.__vtDebug__.cy()) returns a
 * typed CyDump once a vault is loaded:
 * - nodes.length matches the count of rendered cytoscape nodes (± 5)
 * - dump has the correct shape: nodes, edges, viewport, selection arrays
 * - nodes have id, classes, position, visible fields
 * - viewport has zoom and pan
 *
 * Class b verifier: Playwright loads fixture vault, asserts golden count.
 */

import {test as base, expect, _electron as electron} from '@playwright/test'
import type {ElectronApplication, Page} from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'
import type {Core as CytoscapeCore} from 'cytoscape'

const PROJECT_ROOT: string = path.resolve(process.cwd())
const FIXTURE_VAULT_PATH: string = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small')

interface CyDumpNode {
    id: string
    classes: string[]
    position: { x: number; y: number }
    visible: boolean
}

interface CyDumpEdge {
    id: string
    source: string
    target: string
    classes: string[]
}

interface CyDump {
    nodes: CyDumpNode[]
    edges: CyDumpEdge[]
    viewport: { zoom: number; pan: { x: number; y: number } }
    selection: string[]
}

interface VtDebug {
    cy: () => CyDump | null
}

interface DebugWindow {
    __vtDebug__?: VtDebug
    cytoscapeInstance?: CytoscapeCore
}

const test = base.extend<{
    electronApp: ElectronApplication
    appWindow: Page
}>({
    electronApp: [async ({}, use): Promise<void> => {
        const tempUserDataPath: string = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-cy-dump-test-'),
        )

        const configPath: string = path.join(tempUserDataPath, 'voicetree-config.json')
        await fs.writeFile(configPath, JSON.stringify({
            lastDirectory: FIXTURE_VAULT_PATH,
            suffixes: {[FIXTURE_VAULT_PATH]: ''},
        }, null, 2), 'utf8')

        const projectsPath: string = path.join(tempUserDataPath, 'projects.json')
        await fs.writeFile(projectsPath, JSON.stringify([{
            id: 'test-cy-dump',
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
            timeout: 15000,
        })

        await use(electronApp)

        await electronApp.close()
        await fs.rm(tempUserDataPath, {recursive: true, force: true})
    }, {timeout: 45000}],

    appWindow: [async ({electronApp}, use): Promise<void> => {
        const page: Page = await electronApp.firstWindow({timeout: 15000})

        page.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()))
        page.on('pageerror', error => console.error('PAGE ERROR:', error.message))

        await page.waitForLoadState('domcontentloaded')

        // Click the project to load it
        const projectButton = page.locator('button', {hasText: 'example_small'})
        await projectButton.waitFor({timeout: 20000})
        await projectButton.click()

        // Wait for cytoscape to initialize with nodes
        await page.waitForFunction(
            () => ((window as unknown as DebugWindow).cytoscapeInstance?.nodes().length ?? 0) > 0,
            {timeout: 25000},
        )
        // Let layout settle
        await page.waitForTimeout(500)

        await use(page)
    }, {timeout: 45000}],
})

test.describe('BF-DBG-204b — window.__vtDebug__.cy() dump', () => {
    test('cy() returns CyDump with nodes matching rendered count ± 5', async ({appWindow}) => {
        test.setTimeout(60000)

        // Golden: count via cytoscapeInstance directly
        const goldenNodeCount: number = await appWindow.evaluate(
            () => (window as unknown as DebugWindow).cytoscapeInstance!.nodes().length,
        )
        expect(goldenNodeCount).toBeGreaterThan(0)

        // Subject under test: window.__vtDebug__.cy()
        const dump = await appWindow.evaluate(
            () => (window as unknown as DebugWindow).__vtDebug__!.cy(),
        )

        // Must return a non-null CyDump
        expect(dump).not.toBeNull()
        const cyDump = dump as CyDump

        // Shape checks
        expect(Array.isArray(cyDump.nodes)).toBe(true)
        expect(Array.isArray(cyDump.edges)).toBe(true)
        expect(Array.isArray(cyDump.selection)).toBe(true)
        expect(typeof cyDump.viewport).toBe('object')
        expect(typeof cyDump.viewport.zoom).toBe('number')
        expect(typeof cyDump.viewport.pan).toBe('object')
        expect(typeof cyDump.viewport.pan.x).toBe('number')
        expect(typeof cyDump.viewport.pan.y).toBe('number')

        // Node field checks
        expect(cyDump.nodes.length).toBeGreaterThan(0)
        const firstNode = cyDump.nodes[0]
        expect(typeof firstNode.id).toBe('string')
        expect(firstNode.id.length).toBeGreaterThan(0)
        expect(Array.isArray(firstNode.classes)).toBe(true)
        expect(typeof firstNode.position.x).toBe('number')
        expect(typeof firstNode.position.y).toBe('number')
        expect(typeof firstNode.visible).toBe('boolean')

        // Edge field checks (if any edges exist)
        if (cyDump.edges.length > 0) {
            const firstEdge = cyDump.edges[0]
            expect(typeof firstEdge.id).toBe('string')
            expect(typeof firstEdge.source).toBe('string')
            expect(typeof firstEdge.target).toBe('string')
            expect(Array.isArray(firstEdge.classes)).toBe(true)
        }

        // Golden count: dump.nodes.length should match cy.nodes().length within ± 5 tolerance
        const tolerance = 5
        expect(Math.abs(cyDump.nodes.length - goldenNodeCount)).toBeLessThanOrEqual(tolerance)

        console.log(`BF-DBG-204b PASS: dump.nodes=${cyDump.nodes.length}, cy.nodes=${goldenNodeCount}, edges=${cyDump.edges.length}, zoom=${cyDump.viewport.zoom}`)
    })
})
