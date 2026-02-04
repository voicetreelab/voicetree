/**
 * No Visible Nodes Toast
 *
 * Non-intrusive toast notification shown when user pans/zooms to a viewport
 * with no visible nodes. Provides a "Fit to Graph" button to bring nodes back into view.
 */

export interface NoVisibleNodesToastOptions {
  onFit: () => void;
  onDismiss: () => void;
}

let toastElement: HTMLDivElement | null = null;

/**
 * Show the "no visible nodes" toast notification.
 * Returns the toast element for tracking.
 *
 * @param options - Callbacks for fit and dismiss actions
 * @returns The toast element
 */
export function showNoVisibleNodesToast(options: NoVisibleNodesToastOptions): HTMLDivElement {
  // Prevent duplicate toasts
  if (toastElement) {
    return toastElement;
  }

  const toast: HTMLDivElement = document.createElement('div');
  toast.id = 'no-visible-nodes-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    z-index: 50;
    font-family: inherit;
    animation: toast-slide-up 0.2s ease-out;
  `;

  // Add animation keyframes if not already present
  if (!document.getElementById('no-visible-nodes-toast-styles')) {
    const style: HTMLStyleElement = document.createElement('style');
    style.id = 'no-visible-nodes-toast-styles';
    style.textContent = `
      @keyframes toast-slide-up {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
    `;
    document.head.appendChild(style);
  }

  toast.innerHTML = `
    <span style="color: var(--muted-foreground); font-size: 0.85rem;">
      No nodes in view
    </span>
    <button
      id="fit-to-graph-btn"
      style="
        padding: 6px 12px;
        background: var(--primary);
        color: var(--primary-foreground);
        border: none;
        border-radius: calc(var(--radius) - 2px);
        font-size: 0.8rem;
        cursor: pointer;
        font-family: inherit;
      "
    >Fit to Graph</button>
    <button
      id="dismiss-toast-btn"
      style="
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
      "
      aria-label="Dismiss"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M1 1l12 12M1 13L13 1"/>
      </svg>
    </button>
  `;

  document.body.appendChild(toast);

  const fitBtn: HTMLButtonElement | null = toast.querySelector('#fit-to-graph-btn');
  const dismissBtn: HTMLButtonElement | null = toast.querySelector('#dismiss-toast-btn');

  fitBtn?.addEventListener('click', () => {
    options.onFit();
  });

  dismissBtn?.addEventListener('click', () => {
    options.onDismiss();
  });

  // Hover states
  fitBtn?.addEventListener('mouseenter', () => {
    if (fitBtn) fitBtn.style.opacity = '0.9';
  });
  fitBtn?.addEventListener('mouseleave', () => {
    if (fitBtn) fitBtn.style.opacity = '1';
  });
  dismissBtn?.addEventListener('mouseenter', () => {
    if (dismissBtn) dismissBtn.style.backgroundColor = 'var(--muted)';
  });
  dismissBtn?.addEventListener('mouseleave', () => {
    if (dismissBtn) dismissBtn.style.backgroundColor = 'transparent';
  });

  toastElement = toast;
  return toast;
}

/**
 * Hide and remove the "no visible nodes" toast.
 */
export function hideNoVisibleNodesToast(): void {
  if (toastElement) {
    toastElement.remove();
    toastElement = null;
  }
}

/**
 * Check if the toast is currently shown.
 */
export function isNoVisibleNodesToastShown(): boolean {
  return toastElement !== null;
}
