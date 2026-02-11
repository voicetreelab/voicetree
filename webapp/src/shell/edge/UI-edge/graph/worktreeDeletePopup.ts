/**
 * Worktree Deletion Confirmation Popup
 *
 * Shows the exact git command that will be run before deleting a worktree.
 * Handles async deletion with inline error display and force-delete fallback.
 * Pattern follows agentCommandEditorPopup.ts
 */

// Import ElectronAPI type for window.electronAPI access
import type {} from "@/shell/electron";

export interface WorktreeDeleteResult {
    readonly force: boolean;
}

export interface WorktreeDeleteCallbacks {
    readonly onDelete: (force: boolean) => Promise<{ success: boolean; error?: string }>;
}

/** Build the git worktree remove command string (pure, no IPC) */
function buildRemoveCommand(worktreePath: string, force: boolean): string {
    return `git worktree remove ${force ? '--force ' : ''}"${worktreePath}"`;
}

function escapeHtml(text: string): string {
    const div: HTMLDivElement = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Shows a modal confirmation dialog for worktree deletion.
 * Displays the branch name, path, and exact git command that will be run.
 * On Delete, calls the onDelete callback and handles success/error inline.
 *
 * @param worktreeName - Display name of the worktree
 * @param worktreePath - Path to the worktree
 * @param branch - Branch name associated with the worktree
 * @param callbacks - Async callbacks for deletion
 * @returns Promise resolving to { force: boolean } on successful delete, or null if cancelled
 */
export function showWorktreeDeleteConfirmation(
    worktreeName: string,
    worktreePath: string,
    branch: string,
    callbacks: WorktreeDeleteCallbacks,
): Promise<WorktreeDeleteResult | null> {
    const command: string = buildRemoveCommand(worktreePath, false);
    const forceCommand: string = buildRemoveCommand(worktreePath, true);

    return new Promise((resolve: (value: WorktreeDeleteResult | null) => void) => {
        const dialog: HTMLDialogElement = document.createElement('dialog');
        dialog.id = 'worktree-delete-dialog';
        dialog.style.cssText = `
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            padding: 24px;
            max-width: 460px;
            width: 90%;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            margin: 0;
        `;

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    Delete Worktree "${escapeHtml(worktreeName)}"?
                </h2>
                <div style="font-size: 0.9rem; display: flex; flex-direction: column; gap: 6px;">
                    <div><span style="color: var(--muted-foreground);">Branch:</span> ${escapeHtml(branch)}</div>
                    <div><span style="color: var(--muted-foreground);">Path:</span> ${escapeHtml(worktreePath)}</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 0.85rem; color: var(--muted-foreground);">Command that will be run:</span>
                    <code id="command-preview" style="
                        display: block;
                        padding: 8px 12px;
                        background: var(--muted);
                        border-radius: calc(var(--radius) - 2px);
                        font-family: monospace;
                        font-size: 0.85rem;
                        white-space: pre-wrap;
                        word-break: break-all;
                    ">${escapeHtml(command)}
&amp;&amp; git worktree prune</code>
                </div>
                <div id="error-message" style="
                    display: none;
                    padding: 8px 12px;
                    background: hsl(0 84% 60% / 0.1);
                    border: 1px solid hsl(0 84% 60% / 0.3);
                    border-radius: calc(var(--radius) - 2px);
                    color: hsl(0 84% 60%);
                    font-size: 0.85rem;
                    white-space: pre-wrap;
                "></div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                    <button type="button" id="cancel-btn" style="
                        padding: 6px 16px;
                        border: 1px solid var(--border);
                        border-radius: var(--radius);
                        background: transparent;
                        color: var(--foreground);
                        cursor: pointer;
                        font-size: 0.9rem;
                    ">Cancel</button>
                    <button type="button" id="force-delete-btn" style="
                        display: none;
                        padding: 6px 16px;
                        border: 1px solid hsl(0 84% 60% / 0.5);
                        border-radius: var(--radius);
                        background: hsl(0 84% 60% / 0.1);
                        color: hsl(0 84% 60%);
                        cursor: pointer;
                        font-size: 0.9rem;
                    ">Force Delete</button>
                    <button type="button" id="delete-btn" style="
                        padding: 6px 16px;
                        border: 1px solid hsl(0 84% 60%);
                        border-radius: var(--radius);
                        background: hsl(0 84% 60%);
                        color: white;
                        cursor: pointer;
                        font-size: 0.9rem;
                    ">Delete</button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const cancelBtn: HTMLButtonElement = dialog.querySelector('#cancel-btn') as HTMLButtonElement;
        const deleteBtn: HTMLButtonElement = dialog.querySelector('#delete-btn') as HTMLButtonElement;
        const forceDeleteBtn: HTMLButtonElement = dialog.querySelector('#force-delete-btn') as HTMLButtonElement;
        const errorMessage: HTMLDivElement = dialog.querySelector('#error-message') as HTMLDivElement;
        const commandPreview: HTMLElement = dialog.querySelector('#command-preview') as HTMLElement;

        function setButtonsDisabled(disabled: boolean): void {
            cancelBtn.disabled = disabled;
            deleteBtn.disabled = disabled;
            forceDeleteBtn.disabled = disabled;
            const opacity: string = disabled ? '0.5' : '1';
            const cursor: string = disabled ? 'not-allowed' : 'pointer';
            cancelBtn.style.opacity = opacity;
            cancelBtn.style.cursor = cursor;
            deleteBtn.style.opacity = opacity;
            deleteBtn.style.cursor = cursor;
            forceDeleteBtn.style.opacity = opacity;
            forceDeleteBtn.style.cursor = cursor;
        }

        async function attemptDelete(force: boolean): Promise<void> {
            setButtonsDisabled(true);
            const btn: HTMLButtonElement = force ? forceDeleteBtn : deleteBtn;
            const originalText: string = btn.textContent ?? '';
            btn.textContent = 'Deleting\u2026';
            errorMessage.style.display = 'none';

            const result: { success: boolean; error?: string } = await callbacks.onDelete(force);

            if (result.success) {
                dialog.close();
                resolve({ force });
            } else {
                errorMessage.textContent = result.error ?? 'Deletion failed';
                errorMessage.style.display = 'block';
                btn.textContent = originalText;
                setButtonsDisabled(false);

                if (!force) {
                    // Reveal Force Delete and update command preview to show --force
                    forceDeleteBtn.style.display = 'inline-block';
                    commandPreview.textContent = `${forceCommand}\n&& git worktree prune`;
                }
            }
        }

        cancelBtn.addEventListener('click', () => {
            dialog.close();
            resolve(null);
        });

        deleteBtn.addEventListener('click', () => {
            void attemptDelete(false);
        });

        forceDeleteBtn.addEventListener('click', () => {
            void attemptDelete(true);
        });

        dialog.addEventListener('close', () => {
            dialog.remove();
        });

        dialog.addEventListener('cancel', (e: Event) => {
            e.preventDefault();
        });

        dialog.showModal();
    });
}
