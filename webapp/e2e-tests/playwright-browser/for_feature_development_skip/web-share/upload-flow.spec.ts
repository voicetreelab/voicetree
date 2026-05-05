/**
 * Upload Flow — Playwright tests for the web share upload page.
 *
 * Tests the UploadPage rendering, file upload via input, share link generation,
 * URL format validation, and clipboard copy functionality.
 */

import { test, expect } from '@playwright/test'
import {
  navigateToUpload,
  getDropZone,
  waitForShareLink,
  getCopyButton,
  readFixtureMarkdownFiles,
} from './helpers'

/** Read fixture .md files and convert to Playwright setInputFiles payload. */
async function fixtureFilePayloads(): Promise<
  { name: string; mimeType: string; buffer: Buffer }[]
> {
  const mdFiles = await readFixtureMarkdownFiles()
  // Take a small subset to keep uploads fast
  return Array.from(mdFiles.entries())
    .slice(0, 5)
    .map(([name, content]) => ({
      name,
      mimeType: 'text/markdown',
      buffer: Buffer.from(content),
    }))
}

/** Upload fixture files via the hidden file input and wait for success. */
async function uploadFixtureViaInput(
  page: import('@playwright/test').Page,
): Promise<string> {
  const payloads = await fixtureFilePayloads()
  const input = page.locator('input[type="file"]')
  await input.setInputFiles(payloads)
  return waitForShareLink(page)
}

test.describe('Upload Flow', () => {
  test('UploadPage renders with drag-drop zone', async ({ page }) => {
    await navigateToUpload(page)
    const dropZone = await getDropZone(page)
    await expect(dropZone).toBeVisible()
    await expect(
      page.locator('h1', { hasText: 'Share a VoiceTree vault' }),
    ).toBeVisible()
  })

  test('Upload page accessible at /upload route', async ({ page }) => {
    await page.goto('/upload')
    await page.waitForSelector('text=Share a VoiceTree vault', {
      timeout: 10_000,
    })
    await expect(
      page.locator('h1', { hasText: 'Share a VoiceTree vault' }),
    ).toBeVisible()
    const dropZone = await getDropZone(page)
    await expect(dropZone).toBeVisible()
  })

  test('Upload fixture vault via file input', async ({ page }) => {
    await navigateToUpload(page)
    const shareLink = await uploadFixtureViaInput(page)
    expect(shareLink).toMatch(/\/share\//)
  })

  test('Share link URL format is correct', async ({ page }) => {
    await navigateToUpload(page)
    const shareLink = await uploadFixtureViaInput(page)

    // nanoid default: 21 chars from A-Za-z0-9_-
    const match = shareLink.match(/\/share\/([A-Za-z0-9_-]+)$/)
    expect(match).toBeTruthy()
    expect(match![1]).toHaveLength(21)
  })

  test('Copy button copies share URL to clipboard', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await navigateToUpload(page)
    const shareLink = await uploadFixtureViaInput(page)

    const copyButton = getCopyButton(page)
    await copyButton.click()

    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    )
    expect(clipboardText).toContain('/share/')
    // The clipboard URL should end with the same share ID
    const shareId = shareLink.split('/share/')[1]
    expect(clipboardText).toContain(shareId)
  })
})
