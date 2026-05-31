/**
 * User-data migration notice toast.
 *
 * Non-blocking, auto-dismissing toast shown once after a returning 2.9.x user's
 * settings & recent projects are imported into 3.0 on first launch. The import
 * itself happens silently in electron-main before any window exists; this only
 * surfaces the confirmation once the UI is up.
 *
 * Mirrors the vanilla-DOM toast pattern of `noVisibleNodesToast.ts` — the app has
 * no generic toast component, and a one-off module keeps this self-contained.
 */

const TOAST_ID: string = 'userdata-migration-notice-toast';
const AUTO_DISMISS_MS: number = 10_000;

let toastElement: HTMLDivElement | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

/** Hide and remove the migration notice toast. */
export function hideUserDataMigrationNotice(): void {
    if (dismissTimer !== null) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
    }
    if (toastElement) {
        toastElement.remove();
        toastElement = null;
    }
}

/**
 * Show the migration notice toast with the given message. Idempotent — a second
 * call while one is showing is ignored.
 */
export function showUserDataMigrationNotice(message: string): void {
    if (toastElement) {
        return;
    }

    if (!document.getElementById(`${TOAST_ID}-styles`)) {
        const style: HTMLStyleElement = document.createElement('style');
        style.id = `${TOAST_ID}-styles`;
        style.textContent = `
      @keyframes userdata-migration-toast-slide-up {
        from { opacity: 0; transform: translateX(-50%) translateY(10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
        document.head.appendChild(style);
    }

    const toast: HTMLDivElement = document.createElement('div');
    toast.id = TOAST_ID;
    toast.setAttribute('role', 'status');
    toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    max-width: 90vw;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    z-index: 60;
    font-family: inherit;
    animation: userdata-migration-toast-slide-up 0.2s ease-out;
  `;

    const text: HTMLSpanElement = document.createElement('span');
    text.style.cssText = 'color: var(--foreground); font-size: 0.85rem;';
    text.textContent = message;

    const dismissBtn: HTMLButtonElement = document.createElement('button');
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--muted-foreground);
    cursor: pointer;
    border-radius: 4px;
  `;
    dismissBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M1 1l12 12M1 13L13 1"/>
    </svg>
  `;
    dismissBtn.addEventListener('click', hideUserDataMigrationNotice);
    dismissBtn.addEventListener('mouseenter', () => { dismissBtn.style.backgroundColor = 'var(--muted)'; });
    dismissBtn.addEventListener('mouseleave', () => { dismissBtn.style.backgroundColor = 'transparent'; });

    toast.appendChild(text);
    toast.appendChild(dismissBtn);
    document.body.appendChild(toast);

    toastElement = toast;
    dismissTimer = setTimeout(hideUserDataMigrationNotice, AUTO_DISMISS_MS);
}
