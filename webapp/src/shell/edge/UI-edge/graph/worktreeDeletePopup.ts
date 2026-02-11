/**
 * Worktree Deletion Confirmation Popup
 *
 * Pure confirmation dialog — shows the exact git command that will be run.
 * Returns the user's choice; caller handles actual deletion.
 * Call again with previousError to offer force-delete after a failure.
 */

export interface WorktreeDeleteResult {
    readonly force: boolean;
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
 * Returns { force } on confirm, or null if cancelled.
 *
 * @param worktreeName - Display name of the worktree
 * @param worktreePath - Path to the worktree
 * @param branch - Branch name associated with the worktree
 * @param previousError - If set, shows the error and offers force-delete instead of normal delete
 */
export function showWorktreeDeleteConfirmation(
    worktreeName: string,
    worktreePath: string,
    branch: string,
    previousError?: string,
): Promise<WorktreeDeleteResult | null> {
    const force: boolean = previousError != null;
    const command: string = buildRemoveCommand(worktreePath, force);

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

        const errorHtml: string = previousError
            ? `<div style="
                padding: 8px 12px;
                background: hsl(0 84% 60% / 0.1);
                border: 1px solid hsl(0 84% 60% / 0.3);
                border-radius: calc(var(--radius) - 2px);
                color: hsl(0 84% 60%);
                font-size: 0.85rem;
                white-space: pre-wrap;
            ">${escapeHtml(previousError)}</div>`
            : '';

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    ${force ? 'Force delete' : 'Delete'} Worktree "${escapeHtml(worktreeName)}"?
                </h2>
                <div style="font-size: 0.9rem; display: flex; flex-direction: column; gap: 6px;">
                    <div><span style="color: var(--muted-foreground);">Branch:</span> ${escapeHtml(branch)}</div>
                    <div><span style="color: var(--muted-foreground);">Path:</span> ${escapeHtml(worktreePath)}</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 0.85rem; color: var(--muted-foreground);">Command that will be run:</span>
                    <code style="
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
                ${errorHtml}
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
                    <button type="button" id="confirm-btn" style="
                        padding: 6px 16px;
                        border: 1px solid hsl(0 84% 60%);
                        border-radius: var(--radius);
                        background: ${force ? 'hsl(0 84% 60% / 0.1)' : 'hsl(0 84% 60%)'};
                        color: ${force ? 'hsl(0 84% 60%)' : 'white'};
                        cursor: pointer;
                        font-size: 0.9rem;
                    ">${force ? 'Force Delete' : 'Delete'}</button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const cancelBtn: HTMLButtonElement = dialog.querySelector('#cancel-btn') as HTMLButtonElement;
        const confirmBtn: HTMLButtonElement = dialog.querySelector('#confirm-btn') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => {
            dialog.close();
            resolve(null);
        });

        confirmBtn.addEventListener('click', () => {
            dialog.close();
            resolve({ force });
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
