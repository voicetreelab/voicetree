import type { Page } from '@playwright/test';

type OpenEditResult = {
  success: boolean;
  editedPath?: string | null;
  error?: string;
};

export async function openFirstProjectPathForEditing(appWindow: Page): Promise<OpenEditResult> {
  return await appWindow.evaluate((): Promise<OpenEditResult> => {
    const selectorButton = document.querySelector('button[title^="Write Path"]');
    if (!selectorButton) {
      return Promise.resolve({ success: false, error: 'No selector button found' });
    }

    (selectorButton as HTMLButtonElement).click();

    return new Promise<OpenEditResult>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const dropdown = document.querySelector('.absolute.bottom-full');
          if (!dropdown) {
            resolve({ success: false, error: 'No dropdown found after click' });
            return;
          }

          const rows = Array.from(dropdown.querySelectorAll('div[title]'));
          if (rows.length === 0) {
            resolve({ success: false, error: 'No rows found' });
            return;
          }

          const firstRow = rows[0];
          const rowTitle = firstRow.getAttribute('title');

          const buttons = Array.from(firstRow.querySelectorAll('button'));
          const editButton = buttons.find(b => b.textContent?.includes('\u270E'));

          if (editButton) {
            (editButton as HTMLButtonElement).click();
            resolve({ success: true, editedPath: rowTitle });
          } else {
            resolve({ success: false, error: 'No edit button found' });
          }
        });
      });
    });
  });
}

export function assertOpenedForEditing(result: OpenEditResult): void {
  console.log('Open and click result:', result);
  if (!result.success) {
    throw new Error(result.error ?? 'Unknown error');
  }
}
