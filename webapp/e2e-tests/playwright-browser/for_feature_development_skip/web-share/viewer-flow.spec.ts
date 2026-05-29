import { test, expect } from '@playwright/test'
import {
  uploadMinimalProjectViaAPI,
  navigateToViewer,
  assertGraphVisible,
} from './helpers'

test.describe('Viewer Flow', () => {
  test('viewer loads graph from uploaded project', async ({ page }) => {
    const shareId = await uploadMinimalProjectViaAPI()
    await navigateToViewer(page, shareId)
    await page.waitForSelector('text=Loading graph', { state: 'hidden', timeout: 30_000 })
    await assertGraphVisible(page)
  })

  test('graph container has non-zero dimensions', async ({ page }) => {
    const shareId = await uploadMinimalProjectViaAPI()
    await navigateToViewer(page, shareId)
    await page.waitForSelector('text=Loading graph', { state: 'hidden', timeout: 30_000 })

    const container = page.locator('.h-full.w-full').first()
    await expect(container).toBeVisible()
    const box = await container.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)
  })

  test('loading indicator shows then disappears', async ({ page }) => {
    const shareId = await uploadMinimalProjectViaAPI()
    await page.goto(`/share/${shareId}`)

    // Assert loading text appears initially
    const loading = page.locator('text=Loading graph...')
    await expect(loading).toBeVisible({ timeout: 10_000 })

    // Then wait for it to disappear (ready state replaces it)
    await expect(loading).toBeHidden({ timeout: 30_000 })
  })

  test('no share ID shows error', async ({ page }) => {
    await page.goto('/share/')
    const message = page.locator('text=No share ID provided')
    await expect(message).toBeVisible({ timeout: 10_000 })
  })
})
