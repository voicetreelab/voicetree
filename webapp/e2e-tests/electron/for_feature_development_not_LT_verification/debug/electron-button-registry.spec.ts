/**
 * BEHAVIORAL SPEC — BF-DBG-204c button registry
 *
 * Verifies that window.__vtDebug__.buttons() accurately reflects live registrations:
 * - After 5 registerDebugButton calls → returns 5 entries
 * - After 1 unregisterDebugButton call → returns 4 entries
 *
 * Simulates "mount 5 components, unmount 1" using the window.__vtDebug__ test API
 * installed pre-React in main.tsx (no vault/project needed).
 */

import {test as base, expect, _electron as electron} from '@playwright/test'
import type {ElectronApplication, Page} from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'

const PROJECT_ROOT: string = path.resolve(process.cwd())

interface VtDebug {
    buttons: () => Array<{nodeId: string; label: string; selector: string}>
    registerDebugButton: (entry: {nodeId: string; label: string; selector: string}) => void
    unregisterDebugButton: (nodeId: string, label: string) => void
}

interface DebugWindow {
    __vtDebug__?: VtDebug
}

const test = base.extend<{
    electronApp: ElectronApplication
    appWindow: Page
}>({
    electronApp: [async ({}, use): Promise<void> => {
        const tempUserDataPath: string = await fs.mkdtemp(
            path.join(os.tmpdir(), 'voicetree-button-registry-test-'),
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
            },
            timeout: 15000,
        })

        await use(electronApp)

        await electronApp.close()
        await fs.rm(tempUserDataPath, {recursive: true, force: true})
    }, {timeout: 30000}],

    appWindow: [async ({electronApp}, use): Promise<void> => {
        const page: Page = await electronApp.firstWindow({timeout: 15000})

        page.on('console', msg => console.log(`BROWSER [${msg.type()}]:`, msg.text()))
        page.on('pageerror', error => console.error('PAGE ERROR:', error.message))

        await page.waitForLoadState('domcontentloaded')
        // Give the pre-React install block time to run
        await page.waitForFunction(
            () => typeof (window as unknown as DebugWindow).__vtDebug__ !== 'undefined',
            {timeout: 5000},
        )

        await use(page)
    }, {timeout: 20000}],
})

test.describe('BF-DBG-204c — button registry', () => {
    test('registers 5 buttons and unregisters 1 cleanly', async ({appWindow}) => {
        const fixtures = [
            {nodeId: 'node-a', label: 'Add Child',   selector: '#btn-add-child'},
            {nodeId: 'node-a', label: 'Delete Node',  selector: '#btn-delete'},
            {nodeId: 'node-b', label: 'Edit Title',   selector: '#btn-edit-title'},
            {nodeId: 'node-c', label: 'Collapse',     selector: '#btn-collapse'},
            {nodeId: 'node-d', label: 'Run Agent',    selector: '#btn-run-agent'},
        ]

        // Simulate mounting 5 components — each calls registerDebugButton
        await appWindow.evaluate((entries) => {
            const vtd = (window as unknown as DebugWindow).__vtDebug__!
            for (const entry of entries) {
                vtd.registerDebugButton(entry)
            }
        }, fixtures)

        const countAfterMount = await appWindow.evaluate(
            () => (window as unknown as DebugWindow).__vtDebug__!.buttons().length,
        )
        expect(countAfterMount).toBe(5)

        // Simulate unmounting the first component (cleanup = unregister)
        await appWindow.evaluate(([nodeId, label]: [string, string]) => {
            (window as unknown as DebugWindow).__vtDebug__!.unregisterDebugButton(nodeId, label)
        }, [fixtures[0].nodeId, fixtures[0].label] as [string, string])

        const countAfterUnmount = await appWindow.evaluate(
            () => (window as unknown as DebugWindow).__vtDebug__!.buttons().length,
        )
        expect(countAfterUnmount).toBe(4)

        // Verify the remaining entries are correct (the unmounted one is gone)
        const remaining = await appWindow.evaluate(
            () => (window as unknown as DebugWindow).__vtDebug__!.buttons(),
        )
        expect(remaining.some(b => b.label === 'Add Child')).toBe(false)
        expect(remaining.map(b => b.label).sort()).toEqual([
            'Collapse', 'Delete Node', 'Edit Title', 'Run Agent',
        ])
    })
})
