/**
 * Worktree Delete Event Handler
 *
 * Listens for vt:request-worktree-delete custom events dispatched by the trash icon
 * in the Run dropdown submenu. Orchestrates: confirmation popup -> IPC deletion -> toast.
 */

import type {} from '@/shell/electron';
import { showWorktreeDeleteConfirmation } from './worktreeDeletePopup';

interface WorktreeDeleteDetail {
    readonly path: string;
    readonly branch: string;
    readonly name: string;
}

/**
 * Handle the vt:request-worktree-delete custom event.
 * Wired up in setupViewSubscriptions.ts.
 */
export function handleWorktreeDeleteEvent(event: Event): void {
    const detail: WorktreeDeleteDetail = (event as CustomEvent<WorktreeDeleteDetail>).detail;
    void handleWorktreeDelete(detail);
}

async function handleWorktreeDelete(detail: WorktreeDeleteDetail): Promise<void> {
    const watchStatus: { directory?: string } | undefined = await window.electronAPI?.main.getWatchStatus();
    const repoRoot: string | undefined = watchStatus?.directory;
    if (!repoRoot) return;

    const result: { force: boolean } | null = await showWorktreeDeleteConfirmation(
        detail.name,
        detail.path,
        detail.branch,
        {
            onDelete: async (force: boolean): Promise<{ success: boolean; error?: string }> => {
                const ipcResult: { success: boolean; command: string; error?: string } | undefined =
                    await window.electronAPI?.main.removeWorktree(repoRoot, detail.path, force);
                return ipcResult ?? { success: false, error: 'electronAPI not available' };
            },
        },
    );

    if (result) {
        showToast(`Worktree "${detail.name}" deleted`);
    }
}

/** Show a brief auto-dismissing toast notification at the bottom of the screen */
function showToast(message: string, durationMs: number = 3000): void {
    const toast: HTMLDivElement = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        padding: 10px 20px;
        background: var(--primary);
        color: var(--primary-foreground);
        border-radius: var(--radius);
        font-size: 0.9rem;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 200);
    }, durationMs);
}
