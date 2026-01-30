/**
 * Task Input Popup
 *
 * Displays an HTML dialog for entering a task description before spawning
 * an agent on selected nodes. Shows the selected node titles for user reference.
 *
 * Pattern follows agentCommandEditorPopup.ts
 */

export interface TaskInputResult {
    taskDescription: string;
}

export interface SelectedNodeInfo {
    id: string;
    title: string;
}

/**
 * Shows a modal dialog for entering a task description before spawning an agent.
 *
 * @param selectedNodes - Array of selected node info (id and title)
 * @returns Promise resolving to the task description on confirm, or null if cancelled/empty
 */
export function showTaskInputPopup(selectedNodes: SelectedNodeInfo[]): Promise<TaskInputResult | null> {
    return new Promise((resolve: (value: TaskInputResult | null) => void) => {
        const dialog: HTMLDialogElement = document.createElement('dialog');
        dialog.id = 'task-input-dialog';
        dialog.style.cssText = `
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            padding: 24px;
            max-width: 520px;
            width: 90%;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            margin: 0;
        `;

        const nodeCount: number = selectedNodes.length;
        const nodeListHtml: string = selectedNodes
            .map((node: SelectedNodeInfo) => `<li style="margin: 4px 0; font-size: 0.85rem;">${escapeHtml(node.title)}</li>`)
            .join('');

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    Run Agent on ${nodeCount} Node${nodeCount !== 1 ? 's' : ''}
                </h2>
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    Enter a task description for the agent.
                </p>
                <div style="
                    padding: 12px;
                    border: 1px solid var(--border);
                    border-radius: calc(var(--radius) - 2px);
                    background: var(--muted);
                    max-height: 120px;
                    overflow-y: auto;
                ">
                    <span style="font-size: 0.8rem; color: var(--muted-foreground); display: block; margin-bottom: 8px;">
                        Selected nodes:
                    </span>
                    <ul data-testid="selected-nodes-list" style="margin: 0; padding-left: 20px; list-style-type: disc;">
                        ${nodeListHtml}
                    </ul>
                </div>
                <label style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 0.85rem; color: var(--muted-foreground);">Task Description</span>
                    <textarea
                        id="task-description-input"
                        data-testid="task-description-input"
                        rows="4"
                        placeholder="Describe what you want the agent to do..."
                        style="
                            width: 100%;
                            padding: 10px 12px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--input);
                            color: var(--foreground);
                            font-family: inherit;
                            font-size: 0.9rem;
                            box-sizing: border-box;
                            resize: vertical;
                            min-height: 80px;
                        "
                    ></textarea>
                </label>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button
                        type="button"
                        id="cancel-button"
                        data-testid="cancel-button"
                        style="
                            padding: 8px 16px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: transparent;
                            color: var(--foreground);
                            cursor: pointer;
                            font-size: 0.9rem;
                        "
                    >Cancel</button>
                    <button
                        type="submit"
                        id="confirm-button"
                        data-testid="confirm-button"
                        disabled
                        style="
                            padding: 8px 16px;
                            border: none;
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--primary);
                            color: var(--primary-foreground);
                            cursor: not-allowed;
                            font-size: 0.9rem;
                            opacity: 0.5;
                        "
                    >Run Agent</button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const form: HTMLFormElement = dialog.querySelector('form')!;
        const textarea: HTMLTextAreaElement = dialog.querySelector('#task-description-input')!;
        const confirmButton: HTMLButtonElement = dialog.querySelector('#confirm-button')!;
        const cancelButton: HTMLButtonElement = dialog.querySelector('#cancel-button')!;

        // Enable confirm button only when there's content
        textarea.addEventListener('input', () => {
            const hasContent: boolean = textarea.value.trim().length > 0;
            confirmButton.disabled = !hasContent;
            confirmButton.style.opacity = hasContent ? '1' : '0.5';
            confirmButton.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        });

        // Cancel button click handler
        cancelButton.addEventListener('click', () => {
            dialog.close();
            resolve(null);
        });

        // Form submit (Confirm button) handler
        form.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            const taskDescription: string = textarea.value.trim();
            dialog.close();
            if (!taskDescription) {
                resolve(null);
                return;
            }
            resolve({ taskDescription });
        });

        // Clean up dialog on close
        dialog.addEventListener('close', () => {
            dialog.remove();
        });

        // Prevent Escape key from closing without resolving
        dialog.addEventListener('cancel', (e: Event) => {
            e.preventDefault();
        });

        dialog.showModal();
        textarea.focus();
    });
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
    const div: HTMLDivElement = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
