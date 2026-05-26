import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function waitForProjectScannerToSettle(page: Page): Promise<void> {
    await page.locator('text=Scanning for projects').waitFor({ state: 'hidden', timeout: 10000 })
        .catch(() => {
            console.log('Project scanner still visible after 10s; continuing with saved project selection');
        });
}

export async function savedProjectButton(page: Page, projectName: string) {
    const button = page.getByTestId('saved-project-button').filter({ hasText: projectName }).first();
    await expect(button).toBeVisible({ timeout: 10000 });
    return button;
}

export async function clickSavedProject(page: Page, projectName: string): Promise<void> {
    await page.waitForSelector('text=Recent Projects', { timeout: 10000 });
    await waitForProjectScannerToSettle(page);
    const button = await savedProjectButton(page, projectName);
    await button.evaluate((element: HTMLElement) => element.click());
}

export async function clickBackToProjectSelection(page: Page): Promise<void> {
    const backButton = page.locator('button[title="Back to project selection"]');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    await backButton.evaluate((element: HTMLElement) => element.click());
}
