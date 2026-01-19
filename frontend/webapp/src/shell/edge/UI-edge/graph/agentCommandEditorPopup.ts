/**
 * Agent Command Editor Popup
 *
 * Displays an HTML dialog for viewing and editing agent commands before execution.
 * Replaces the native Electron dialog.showMessageBox() for a better UX.
 *
 * Pattern follows userEngagementPrompts.ts
 */

export const AUTO_RUN_FLAG: string = '--dangerously-skip-permissions';

export interface AgentCommandEditorResult {
    command: string;
    agentPrompt: string;
    mcpIntegrationEnabled: boolean;
    inNewWorktree: boolean;
}

/**
 * Shows a modal dialog for editing an agent command and prompt before execution.
 *
 * @param command - The initial command to display
 * @param agentPrompt - The initial agent prompt to display (editable)
 * @returns Promise resolving to the (possibly modified) command and prompt on Run click, or null if cancelled
 */
export function showAgentCommandEditor(command: string, agentPrompt: string): Promise<AgentCommandEditorResult | null> {
    return new Promise((resolve: (value: AgentCommandEditorResult | null) => void) => {
        const dialog: HTMLDialogElement = document.createElement('dialog');
        dialog.id = 'agent-command-editor-dialog';
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

        const hasAutoRunFlag: boolean = command.includes(AUTO_RUN_FLAG);

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    Agent Command
                </h2>
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    Review or edit the command and prompt before running.
                </p>
                <label style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 0.85rem; color: var(--muted-foreground);">Agent Prompt</span>
                    <textarea
                        id="agent-prompt-input"
                        data-testid="agent-prompt-input"
                        rows="6"
                        style="
                            width: 100%;
                            padding: 10px 12px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--input);
                            color: var(--foreground);
                            font-family: monospace;
                            font-size: 0.85rem;
                            box-sizing: border-box;
                            resize: vertical;
                            min-height: 100px;
                        "
                    ></textarea>
                </label>
                <label style="display: flex; flex-direction: column; gap: 6px;">
                    <span style="font-size: 0.85rem; color: var(--muted-foreground);">Command</span>
                    <input
                        type="text"
                        id="command-input"
                        style="
                            width: 100%;
                            padding: 10px 12px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--input);
                            color: var(--foreground);
                            font-family: monospace;
                            font-size: 0.9rem;
                            box-sizing: border-box;
                        "
                    />
                </label>
                <div style="
                    padding: 12px;
                    border: 1px solid var(--border);
                    border-radius: calc(var(--radius) - 2px);
                    background: var(--muted);
                ">
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
                        <input
                            type="checkbox"
                            id="mcp-integration-toggle"
                            data-testid="mcp-integration-toggle"
                            checked
                            style="
                                margin-top: 2px;
                                width: 16px;
                                height: 16px;
                                cursor: pointer;
                            "
                        />
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-size: 0.85rem; font-weight: 500;">
                                ⚗️ Enable MCP Integration
                            </span>
                            <span style="font-size: 0.8rem; color: var(--muted-foreground);">
                                Let agents spawn sub-agents directly in the graph (experimental)
                            </span>
                        </div>
                    </label>
                </div>
                <div style="
                    padding: 12px;
                    border: 1px solid var(--border);
                    border-radius: calc(var(--radius) - 2px);
                    background: var(--muted);
                ">
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
                        <input
                            type="checkbox"
                            id="auto-run-toggle"
                            data-testid="auto-run-toggle"
                            ${hasAutoRunFlag ? 'checked' : ''}
                            style="
                                margin-top: 2px;
                                width: 16px;
                                height: 16px;
                                cursor: pointer;
                            "
                        />
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-size: 0.85rem; font-weight: 500;">
                                Auto-run
                            </span>
                            <span style="font-size: 0.8rem; color: var(--muted-foreground);">
                                Skip permission prompts (--dangerously-skip-permissions)
                            </span>
                        </div>
                    </label>
                </div>
                <div style="
                    padding: 12px;
                    border: 1px solid var(--border);
                    border-radius: calc(var(--radius) - 2px);
                    background: var(--muted);
                ">
                    <label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">
                        <input
                            type="checkbox"
                            id="worktree-toggle"
                            data-testid="worktree-toggle"
                            style="
                                margin-top: 2px;
                                width: 16px;
                                height: 16px;
                                cursor: pointer;
                            "
                        />
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-size: 0.85rem; font-weight: 500;">
                                🌿 Run in Worktree
                            </span>
                            <span style="font-size: 0.8rem; color: var(--muted-foreground);">
                                Spawn agent in isolated git worktree branch
                            </span>
                        </div>
                    </label>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                    <div style="display: flex; gap: 8px;">
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
                            id="run-button"
                            data-testid="run-button"
                            style="
                                padding: 8px 16px;
                                border: none;
                                border-radius: calc(var(--radius) - 2px);
                                background: var(--primary);
                                color: var(--primary-foreground);
                                cursor: pointer;
                                font-size: 0.9rem;
                            "
                        >Run</button>
                    </div>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const form: HTMLFormElement = dialog.querySelector('form')!;
        const promptTextarea: HTMLTextAreaElement = dialog.querySelector('#agent-prompt-input')!;
        const input: HTMLInputElement = dialog.querySelector('#command-input')!;
        const mcpToggle: HTMLInputElement = dialog.querySelector('#mcp-integration-toggle')!;
        const autoRunToggle: HTMLInputElement = dialog.querySelector('#auto-run-toggle')!;
        const worktreeToggle: HTMLInputElement = dialog.querySelector('#worktree-toggle')!;
        const cancelButton: HTMLButtonElement = dialog.querySelector('#cancel-button')!;

        // Set values programmatically to avoid HTML escaping issues with quotes
        promptTextarea.value = agentPrompt;
        input.value = command;

        // Update auto-run checkbox state when input changes
        input.addEventListener('input', () => {
            const currentHasFlag: boolean = input.value.includes(AUTO_RUN_FLAG);
            autoRunToggle.checked = currentHasFlag;
        });

        // Auto-run checkbox change handler
        autoRunToggle.addEventListener('change', () => {
            const currentHasFlag: boolean = input.value.includes(AUTO_RUN_FLAG);
            if (autoRunToggle.checked && !currentHasFlag) {
                // Insert flag after 'claude' command, preserving the rest of the command
                input.value = input.value.replace(
                    /^(claude)\s+(.*)$/,
                    `$1 ${AUTO_RUN_FLAG} $2`
                );
                // If no 'claude' prefix, just prepend the flag
                if (!input.value.includes(AUTO_RUN_FLAG)) {
                    input.value = `${AUTO_RUN_FLAG} ${input.value}`;
                }
            } else if (!autoRunToggle.checked && currentHasFlag) {
                // Remove the flag from the command
                input.value = input.value.replace(new RegExp(`\\s*${AUTO_RUN_FLAG}\\s*`), ' ').trim();
            }
        });

        // Worktree checkbox change handler
        const WORKTREE_INDICATOR: string = '[worktree] ';
        worktreeToggle.addEventListener('change', () => {
            if (worktreeToggle.checked && !input.value.startsWith(WORKTREE_INDICATOR)) {
                input.value = WORKTREE_INDICATOR + input.value;
            } else if (!worktreeToggle.checked && input.value.startsWith(WORKTREE_INDICATOR)) {
                input.value = input.value.slice(WORKTREE_INDICATOR.length);
            }
        });

        // Cancel button click handler
        cancelButton.addEventListener('click', () => {
            dialog.close();
            resolve(null);
        });

        // Form submit (Run button) handler
        form.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            const finalCommand: string = input.value.trim();
            const finalPrompt: string = promptTextarea.value.trim();
            const mcpEnabled: boolean = mcpToggle.checked;
            dialog.close();
            if (!finalCommand) {
                resolve(null);
                return;
            }
            resolve({ command: finalCommand, agentPrompt: finalPrompt, mcpIntegrationEnabled: mcpEnabled, inNewWorktree: worktreeToggle.checked });
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
        input.focus();
        input.select();
    });
}