/**
 * BF-DBG-204a — Verifier (b): ring buffer captures ReferenceError thrown during startup.
 *
 * The critical guarantee: __vtDebug__ is installed BEFORE React bootstrap in main.tsx,
 * so errors thrown in a startup useEffect (or during module load) are captured even though
 * regular devtools-after-crash would miss them.
 *
 * Run: npx electron-vite build && npx playwright test electron-debug-ring-buffer.spec.ts --config=playwright-electron.config.ts
 */

import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'

const PROJECT_ROOT = path.resolve(process.cwd())

const test = base.extend<{ electronApp: ElectronApplication; appWindow: Page }>({
  electronApp: [async ({}, use) => {
    const tempUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-ring-buf-'))

    const electronApp = await electron.launch({
      args: [
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${tempUserDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HEADLESS_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
      },
      timeout: 15000,
    })

    await use(electronApp)
    await electronApp.close()
    await fs.rm(tempUserDataPath, { recursive: true, force: true })
  }, { timeout: 30000 }],

  appWindow: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow({ timeout: 15000 })
    // Wait until main.tsx has run and __vtDebug__ is installed (pre-React, so very early)
    await page.waitForFunction(() => '__vtDebug__' in window, { timeout: 10000 })
    await use(page)
  }, { timeout: 30000 }],
})

test('ring buffer captures ReferenceError thrown during startup (pre-React hook)', async ({ appWindow: page }) => {
  // 1. Confirm __vtDebug__ is present (pre-React install succeeded)
  const hasDebug = await page.evaluate(() => '__vtDebug__' in window)
  expect(hasDebug).toBe(true)

  // 2. Simulate a ReferenceError thrown during a startup useEffect.
  //    This is the failure mode that normal devtools-after-crash would miss because
  //    the error fires before the developer opens devtools.
  await page.evaluate(() => {
    const err = new ReferenceError('undeclaredVarAtStartup is not defined')
    window.dispatchEvent(new ErrorEvent('error', {
      message: err.message,
      error: err,
      filename: 'renderer/shell/UI/App.tsx',
      lineno: 12,
      colno: 1,
    }))
  })

  type ExceptionMsg = { message: string; stack?: string; atIso: string }
  type ConsoleMsg   = { level: string; args: unknown[]; atIso: string }
  type VtDebug = { exceptions(): ExceptionMsg[]; console(n: number): ConsoleMsg[] }
  type VtDebugWindow = Window & { __vtDebug__: VtDebug }

  // 3. Assert the ring buffer captured the exception
  const exceptions = await page.evaluate(() =>
    (window as unknown as VtDebugWindow).__vtDebug__.exceptions()
  )

  expect(exceptions.length).toBeGreaterThanOrEqual(1)
  const match = exceptions.find(e => e.message.includes('undeclaredVarAtStartup'))
  expect(match).toBeDefined()
  expect(typeof match!.atIso).toBe('string')
  expect(match!.stack).toBeTruthy()

  // 4. Also verify the console hook is working (secondary ring buffer)
  await page.evaluate(() => console.error('vt-ring-buf-test-marker', { code: 204 }))
  const consoleMsgs = await page.evaluate(() =>
    (window as unknown as VtDebugWindow).__vtDebug__.console(500)
  )
  const errorEntry = consoleMsgs.find(
    m => m.level === 'error' &&
         Array.isArray(m.args) &&
         m.args[0] === 'vt-ring-buf-test-marker'
  )
  expect(errorEntry).toBeDefined()
  expect(typeof errorEntry!.atIso).toBe('string')
})
