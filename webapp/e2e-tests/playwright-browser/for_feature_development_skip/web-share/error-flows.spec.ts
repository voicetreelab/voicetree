import { test, expect } from '@playwright/test'
import { navigateToUpload, assertViewerError, assertUploadError } from './helpers'

test.describe('Error Flows', () => {
  test('non-existent share shows error', async ({ page }) => {
    await page.goto('/share/nonexistent-id-12345')

    await assertViewerError(page, 'not found')

    // Verify the full error message format from formatViewError
    const errorText = page.locator('.text-neutral-300')
    await expect(errorText).toContainText('Share "nonexistent-id-12345" not found.')
  })

  test('upload with no .md files shows error', async ({ page }) => {
    await navigateToUpload(page)

    // The file input has webkitdirectory — remove it so setInputFiles works with flat files
    const fileInput = page.locator('input[type="file"]')
    await fileInput.evaluate((el: HTMLInputElement) => {
      el.removeAttribute('webkitdirectory')
    })

    // Upload a single .txt file (no markdown files)
    await fileInput.setInputFiles({
      name: 'readme.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is not a markdown file'),
    })

    await assertUploadError(page, 'No markdown files found')
  })
})
