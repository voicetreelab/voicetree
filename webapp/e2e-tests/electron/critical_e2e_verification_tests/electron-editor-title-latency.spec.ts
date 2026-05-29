import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import type { Core as CytoscapeCore } from 'cytoscape'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ElectronAPI } from '@/shell/electron'
import {
  getCiElectronFlags,
  pollForCondition,
  pollForCytoscape,
  pollForCytoscapeNodes,
  resolveGraphDaemonNodeBin,
  robustElectronTeardown,
  safeStopFileWatching,
} from './electron-smoke-helpers'
import {
  focusEditorInstance,
  getEditorInstanceId,
  readEditorValue,
  waitForEditorInstance,
} from './helpers/editor-instance'

const PROJECT_ROOT = path.resolve(process.cwd())
const ITERATIONS = 30
const P95_BUDGET_MS = 500
const P99_BUDGET_MS = 750

interface ExtendedWindow {
  cytoscapeInstance?: CytoscapeCore
  electronAPI?: ElectronAPI
}

function idSelector(id: string): string {
  return `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
  return sorted[index]
}

function formatLatencyReport(values: readonly number[]): string {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const p50 = percentile(values, 0.50)
  const p95 = percentile(values, 0.95)
  const p99 = percentile(values, 0.99)
  return [
    'editor title latency ms',
    `N=${values.length}`,
    `min=${min.toFixed(1)}`,
    `p50=${p50.toFixed(1)}`,
    `mean=${mean.toFixed(1)}`,
    `p95=${p95.toFixed(1)}`,
    `p99=${p99.toFixed(1)}`,
    `max=${max.toFixed(1)}`,
    `raw=${values.map(value => value.toFixed(1)).join(',')}`,
  ].join(' ')
}

async function seedProject(projectPath: string): Promise<string> {
  const writeFolder = path.join(projectPath, 'voicetree')
  await fs.mkdir(writeFolder, { recursive: true })
  await fs.mkdir(path.join(projectPath, '.voicetree'), { recursive: true })
  await fs.writeFile(
    path.join(writeFolder, 'Latency Target.md'),
    '# Latency Target\n\nInitial content.\n',
    'utf8',
  )
  await fs.writeFile(
    path.join(projectPath, '.voicetree', 'positions.json'),
    JSON.stringify({ 'Latency Target.md': { x: 100, y: 100 } }, null, 2),
    'utf8',
  )
  return writeFolder
}

const test = base.extend<{
  electronApp: ElectronApplication
  appWindow: Page
  projectPath: string
  writeFolder: string
}>({
  projectPath: async ({}, use) => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-title-latency-'))
    await use(projectPath)
    await fs.rm(projectPath, { recursive: true, force: true })
  },

  writeFolder: async ({ projectPath }, use) => {
    const writeFolder = await seedProject(projectPath)
    await use(writeFolder)
  },

  electronApp: async ({ projectPath, writeFolder }, use) => {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-title-latency-app-'))
    await fs.writeFile(
      path.join(userDataPath, 'projects.json'),
      JSON.stringify([
        {
          id: 'editor-title-latency',
          path: projectPath,
          name: path.basename(projectPath),
          type: 'folder',
          lastOpened: Date.now(),
          voicetreeInitialized: true,
        },
      ], null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(userDataPath, 'voicetree-config.json'),
      JSON.stringify({
        lastDirectory: projectPath,
        vaultConfig: {
          [projectPath]: {
            writeFolder,
            readPaths: [],
          },
        },
      }, null, 2),
      'utf8',
    )

    const electronApp = await electron.launch({
      args: [
        ...getCiElectronFlags(),
        '--remote-debugging-port=0',
        path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
        `--user-data-dir=${userDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ENABLE_PLAYWRIGHT_DEBUG: '0',
        HEADLESS_TEST: '1',
        MINIMIZE_TEST: '1',
        VOICETREE_PERSIST_STATE: '1',
        VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
      },
      timeout: 15_000,
    })

    await use(electronApp)

    await safeStopFileWatching(electronApp)
    await robustElectronTeardown(electronApp)
    await fs.rm(userDataPath, { recursive: true, force: true })
  },

  appWindow: async ({ electronApp, projectPath }, use) => {
    const window = await electronApp.firstWindow({ timeout: 15_000 })
    await window.waitForLoadState('domcontentloaded')
    const openResult = await window.evaluate(async (dir) => {
      const api = (window as unknown as ExtendedWindow).electronAPI
      if (!api) throw new Error('electronAPI not available')
      const response = await api.main.openVault(dir)
      return { writeFolder: response.writeFolder }
    }, projectPath)
    expect(openResult.writeFolder, 'openVault returned no writeFolder').toBeTruthy()
    await pollForCytoscape(window, 30_000)
    await pollForCytoscapeNodes(window, 1, 20_000)
    await pollForCondition(window, async () => {
      return await window.evaluate(async () => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance
        const bodyText = document.body.textContent ?? ''
        return Boolean(
          (cy?.nodes().length ?? 0) >= 1 &&
          !bodyText.includes('Loading Voicetree'),
        )
      })
    }, 'Waiting for graph view to settle after file watching start', 10_000)
    await window.waitForTimeout(1_000)
    await use(window)
  },
})

test.describe.configure({ timeout: 120_000 })

test('keystroke-to-graph-label update stays within the editor FS write latency budget', async ({ appWindow, writeFolder }) => {
  await expect.poll(async () => {
    return await appWindow.evaluate(() => {
      const cy = (window as unknown as ExtendedWindow).cytoscapeInstance
      return Boolean(cy?.nodes().some(node => node.data('label') === 'Latency Target'))
    })
  }, { message: 'Waiting for Latency Target node', timeout: 10_000, intervals: [250, 500, 1000, 2000] }).toBe(true)

  const nodeId = await appWindow.evaluate(() => {
    const cy = (window as unknown as ExtendedWindow).cytoscapeInstance
    if (!cy) throw new Error('Cytoscape not initialized')
    const target = cy.nodes().find(node => node.data('label') === 'Latency Target')
    if (!target) throw new Error('Latency Target node not found')
    target.trigger('tap')
    return target.id()
  })

  const editorWindowId = `window-${nodeId}-editor`
  const editorInstanceId = getEditorInstanceId(nodeId)
  const editorContent = appWindow.locator(`${idSelector(editorWindowId)} .cm-content`)
  await editorContent.waitFor({ state: 'visible', timeout: 5_000 })
  await waitForEditorInstance(appWindow, editorInstanceId)
  await focusEditorInstance(appWindow, editorInstanceId)

  await expect.poll(async () => {
    return await appWindow.evaluate((winId) => {
      const windowElement = document.getElementById(winId)
      windowElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      const editorElement = document.querySelector(`#${CSS.escape(winId)} .cm-content`)
      return document.activeElement === editorElement ||
        Boolean(document.activeElement?.closest('.cm-editor'))
    }, editorWindowId)
  }, {
    message: 'Waiting for CodeMirror editor focus',
    timeout: 5_000,
  }).toBe(true)

  const latencies: number[] = []
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

  for (let i = 0; i < ITERATIONS; i += 1) {
    const expectedLabel = `Latency Heading ${String(i).padStart(2, '0')}`
    const nextContent = `# ${expectedLabel}\n\nBody ${i}\n`
    await appWindow.keyboard.press(`${modifier}+A`)
    await appWindow.keyboard.type(nextContent)
    const t0 = performance.now()

    await expect.poll(async () => readEditorValue(appWindow, editorInstanceId), {
      message: `Waiting for editor buffer ${expectedLabel}`,
      timeout: 3_000,
      intervals: [25, 50, 100, 200],
    }).toBe(nextContent)

    await expect.poll(async () => {
      return await appWindow.evaluate((label) => {
        const cy = (window as unknown as ExtendedWindow).cytoscapeInstance
        return Boolean(cy?.nodes().some(node => node.data('label') === label))
      }, expectedLabel)
    }, {
      message: `Waiting for graph label ${expectedLabel}`,
      timeout: 5_000,
      intervals: [10],
    }).toBe(true)

    latencies.push(performance.now() - t0)

    const fileContent = await fs.readFile(path.join(writeFolder, 'Latency Target.md'), 'utf8')
    expect(fileContent).toContain(nextContent)

    const daemonHasContent = await appWindow.evaluate(async ({ id, content }) => {
      const api = (window as unknown as ExtendedWindow).electronAPI
      const node = await api?.main.getNode(id)
      return node?.contentWithoutYamlOrLinks === content
    }, { id: nodeId, content: nextContent })
    expect(daemonHasContent).toBe(true)
  }

  const p95 = percentile(latencies, 0.95)
  const p99 = percentile(latencies, 0.99)
  console.log(formatLatencyReport(latencies))
  expect(p95, formatLatencyReport(latencies)).toBeLessThanOrEqual(P95_BUDGET_MS)
  expect(p99, formatLatencyReport(latencies)).toBeLessThanOrEqual(P99_BUDGET_MS)
})
