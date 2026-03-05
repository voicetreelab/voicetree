/**
 * Shared test utilities for web share Playwright tests.
 *
 * Provides:
 * - Test fixture reading (example_small vault)
 * - Direct API upload (bypasses browser UI)
 * - Page object helpers for UploadPage and ViewerPage
 * - Common Cytoscape assertions
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')
const FIXTURE_VAULT_PATH = path.join(PROJECT_ROOT, 'example_folder_fixtures', 'example_small')

export { PROJECT_ROOT, FIXTURE_VAULT_PATH }

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Read all files from the fixture vault into a Map<relativePath, content>.
 * Recursively walks the vault directory, preserving relative paths.
 * Skips .git directories.
 */
export async function readFixtureFiles(vaultPath: string = FIXTURE_VAULT_PATH): Promise<Map<string, string>> {
  const files = new Map<string, string>()

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const fullPath = path.join(dir, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath)
      } else {
        const content = await fs.readFile(fullPath, 'utf-8')
        files.set(relativePath, content)
      }
    }
  }

  await walk(vaultPath, '')
  return files
}

/**
 * Get just the .md files from the fixture vault (excluding .voicetree/ metadata).
 */
export async function readFixtureMarkdownFiles(vaultPath: string = FIXTURE_VAULT_PATH): Promise<Map<string, string>> {
  const all = await readFixtureFiles(vaultPath)
  const mdFiles = new Map<string, string>()
  for (const [path, content] of all) {
    if (path.endsWith('.md')) {
      mdFiles.set(path, content)
    }
  }
  return mdFiles
}

// ---------------------------------------------------------------------------
// Upload via API helper (bypasses browser UI)
// ---------------------------------------------------------------------------

const WORKER_URL = 'http://localhost:8787'

/**
 * Upload files directly to the worker via POST /upload.
 * Returns the shareId. Useful for testing the viewer without depending on upload UI.
 */
export async function uploadViaAPI(
  files: Map<string, string>,
  folderName: string = 'test-vault',
  workerUrl: string = WORKER_URL,
): Promise<string> {
  const formData = new FormData()
  formData.append('folderName', folderName)

  for (const [name, content] of files) {
    formData.append('files', new File([content], name, { type: 'text/markdown' }))
  }

  const res = await fetch(`${workerUrl}/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Upload failed (${res.status}): ${body}`)
  }

  const json = await res.json() as { shareId: string }
  return json.shareId
}

/**
 * Upload the full fixture vault via API. Returns shareId.
 */
export async function uploadFixtureVaultViaAPI(
  workerUrl: string = WORKER_URL,
): Promise<string> {
  const files = await readFixtureFiles()
  return uploadViaAPI(files, 'example_small', workerUrl)
}

/**
 * Upload a minimal set of markdown files via API for quick tests.
 */
export async function uploadMinimalVaultViaAPI(
  workerUrl: string = WORKER_URL,
): Promise<string> {
  const files = new Map<string, string>([
    ['note1.md', '# Hello\n\nWorld'],
    ['note2.md', '# Second\n\nAnother note\n\n- parent [[note1.md]]'],
    ['sub/note3.md', '# Third\n\nIn a subfolder\n\n- parent [[note1.md]]'],
  ])
  return uploadViaAPI(files, 'minimal-vault', workerUrl)
}

// ---------------------------------------------------------------------------
// UploadPage helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the upload page and wait for it to render.
 */
export async function navigateToUpload(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForSelector('text=Share a VoiceTree vault', { timeout: 10_000 })
}

/**
 * Get the drop zone element on the upload page.
 */
export async function getDropZone(page: Page): Promise<ReturnType<Page['locator']>> {
  return page.locator('text=Drop a folder here or click to browse')
}

/**
 * Wait for the upload to succeed and return the share URL shown on the page.
 */
export async function waitForShareLink(page: Page): Promise<string> {
  await page.waitForSelector('text=Vault shared successfully', { timeout: 30_000 })
  const link = page.locator('a[href*="/share/"]')
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  if (!href) throw new Error('Share link has no href')
  return href
}

/**
 * Get the "Copy link" button on the success page.
 */
export function getCopyButton(page: Page): ReturnType<Page['locator']> {
  return page.locator('button:has-text("Copy link")')
}

// ---------------------------------------------------------------------------
// ViewerPage helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to a share viewer page and wait for it to start loading.
 */
export async function navigateToViewer(page: Page, shareId: string): Promise<void> {
  await page.goto(`/share/${shareId}`)
  // Wait for either the loading indicator or the graph container to appear
  await page.waitForSelector('.h-full.w-full, text=Loading graph', { timeout: 10_000 })
}

/**
 * Wait for Cytoscape to initialize and render nodes on the ViewerPage.
 * Returns the node count.
 */
export async function waitForCytoscapeReady(page: Page, minNodes: number = 1): Promise<number> {
  // Wait for the cytoscape container to have a non-zero size
  await page.waitForFunction(
    () => {
      const container = document.querySelector('.h-full.w-full > div[style]')
      if (!container) return false
      const rect = container.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    },
    { timeout: 15_000 },
  )

  // Wait for cytoscape instance to be available and have nodes
  const nodeCount = await page.waitForFunction(
    (min: number) => {
      // Cytoscape stores its instance on the container element
      const containers = document.querySelectorAll('[class*="h-full"] canvas')
      if (containers.length === 0) return false
      // Try to find cytoscape instance via global or container
      const w = window as unknown as Record<string, unknown>
      const cy = w.cy as { nodes: () => { length: number } } | undefined
      if (cy && cy.nodes().length >= min) return cy.nodes().length
      return false
    },
    minNodes,
    { timeout: 15_000 },
  )

  return nodeCount.jsonValue() as Promise<number>
}

// ---------------------------------------------------------------------------
// Common assertions
// ---------------------------------------------------------------------------

/**
 * Assert that the ViewerPage shows an error message containing the given text.
 */
export async function assertViewerError(page: Page, errorTextSubstring: string): Promise<void> {
  const errorEl = page.locator(`text=${errorTextSubstring}`)
  await expect(errorEl).toBeVisible({ timeout: 10_000 })
}

/**
 * Assert the upload page shows an error containing the given text.
 */
export async function assertUploadError(page: Page, errorTextSubstring: string): Promise<void> {
  const errorEl = page.locator('.text-red-300')
  await expect(errorEl).toBeVisible({ timeout: 10_000 })
  await expect(errorEl).toContainText(errorTextSubstring)
}

/**
 * Assert the graph container is visible and has non-zero dimensions.
 */
export async function assertGraphVisible(page: Page): Promise<void> {
  const container = page.locator('.h-full.w-full').first()
  await expect(container).toBeVisible()
  const box = await container.boundingBox()
  expect(box).toBeTruthy()
  expect(box!.width).toBeGreaterThan(0)
  expect(box!.height).toBeGreaterThan(0)
}
