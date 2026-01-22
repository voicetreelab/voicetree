/**
 * Unit tests for Agent Command Editor Popup
 *
 * Tests the showAgentCommandEditor function that displays an HTML dialog
 * for editing agent commands and prompts before execution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showAgentCommandEditor, AUTO_RUN_FLAG, DOCKER_COMMAND_TEMPLATE, type AgentCommandEditorResult } from './agentCommandEditorPopup';

const DEFAULT_AGENT_PROMPT: string = 'Test agent prompt';

describe('showAgentCommandEditor', () => {
    let mockShowModal: ReturnType<typeof vi.fn>;
    let mockClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Mock HTMLDialogElement methods on the prototype BEFORE dialog creation
        mockShowModal = vi.fn();
        mockClose = vi.fn(function (this: HTMLDialogElement) {
            this.dispatchEvent(new Event('close'));
        });

        HTMLDialogElement.prototype.showModal = mockShowModal;
        HTMLDialogElement.prototype.close = mockClose;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        // Clean up any dialogs left in the DOM
        document.querySelectorAll('dialog').forEach((d: Element) => d.remove());
    });

    function getDialog(): HTMLDialogElement {
        const dialog: HTMLDialogElement | null = document.querySelector('#agent-command-editor-dialog');
        if (!dialog) throw new Error('Dialog not found');
        return dialog;
    }

    // 4.1 Unit Test: showAgentCommandEditor returns modified command on Run click
    it('returns modified command on Run click', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        // Get the dialog that was created
        const dialog: HTMLDialogElement = getDialog();

        // Modify the input
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        expect(input).not.toBeNull();
        input.value = 'claude modified command';

        // Click Run button (triggers form submit)
        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.command).toBe('claude modified command');
        expect(result!.agentPrompt).toBe(DEFAULT_AGENT_PROMPT);
        expect(result!.mcpIntegrationEnabled).toBe(true); // Default enabled
    });

    // 4.2 Unit Test: showAgentCommandEditor returns null on cancel/close
    it('returns null on cancel/close', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();

        // Click Cancel button
        const cancelButton: HTMLButtonElement = dialog.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement;
        expect(cancelButton).not.toBeNull();
        cancelButton.click();

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).toBeNull();
    });

    // 4.3 Unit Test: Auto-run toggle appends --dangerously-skip-permissions flag
    it('Auto-run toggle appends --dangerously-skip-permissions flag and preserves rest of command', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude "$AGENT_PROMPT"', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const autoRunToggle: HTMLInputElement = dialog.querySelector('[data-testid="auto-run-toggle"]') as HTMLInputElement;

        expect(input.value).toBe('claude "$AGENT_PROMPT"');
        expect(autoRunToggle).not.toBeNull();
        expect(autoRunToggle.checked).toBe(false);

        // Check the auto-run toggle
        autoRunToggle.checked = true;
        autoRunToggle.dispatchEvent(new Event('change'));

        // Verify flag was added AND original argument is preserved
        expect(input.value).toBe(`claude ${AUTO_RUN_FLAG} "$AGENT_PROMPT"`);

        // Click Run to get the result
        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.command).toBe(`claude ${AUTO_RUN_FLAG} "$AGENT_PROMPT"`);
    });

    // 4.4 Unit Test: Auto-run toggle is checked when flag already present
    it('Auto-run toggle is checked when flag already present', async () => {
        const commandWithFlag: string = `claude ${AUTO_RUN_FLAG} test`;
        void showAgentCommandEditor(commandWithFlag, DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const autoRunToggle: HTMLInputElement = dialog.querySelector('[data-testid="auto-run-toggle"]') as HTMLInputElement;

        expect(input.value).toBe(commandWithFlag);
        expect(autoRunToggle.checked).toBe(true);
    });

    // 4.5 Unit Test: Unchecking auto-run toggle removes the flag
    it('Unchecking auto-run toggle removes the flag from command', async () => {
        const commandWithFlag: string = `claude ${AUTO_RUN_FLAG} test`;
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor(commandWithFlag, DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const autoRunToggle: HTMLInputElement = dialog.querySelector('[data-testid="auto-run-toggle"]') as HTMLInputElement;

        expect(autoRunToggle.checked).toBe(true);

        // Uncheck the toggle
        autoRunToggle.checked = false;
        autoRunToggle.dispatchEvent(new Event('change'));

        // Verify flag was removed
        expect(input.value).toBe('claude test');

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.command).toBe('claude test');
    });

    it('displays the command in an editable input field', async () => {
        const command: string = 'claude --some-flag test';
        void showAgentCommandEditor(command, DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.value).toBe(command);
        expect(input.readOnly).toBe(false);
    });

    it('has proper dialog structure with all UI elements', async () => {
        void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();

        // Verify dialog has all required UI elements
        expect(dialog.querySelector('form')).not.toBeNull();
        expect(dialog.querySelector('h2')).not.toBeNull();
        expect(dialog.querySelector('#agent-prompt-input')).not.toBeNull();
        expect(dialog.querySelector('#command-input')).not.toBeNull();
        expect(dialog.querySelector('#mcp-integration-toggle')).not.toBeNull();
        expect(dialog.querySelector('[data-testid="auto-run-toggle"]')).not.toBeNull();
        expect(dialog.querySelector('[data-testid="cancel-button"]')).not.toBeNull();
        expect(dialog.querySelector('[data-testid="run-button"]')).not.toBeNull();
    });

    it('MCP integration toggle is enabled by default', async () => {
        void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const mcpToggle: HTMLInputElement = dialog.querySelector('#mcp-integration-toggle') as HTMLInputElement;

        expect(mcpToggle).not.toBeNull();
        expect(mcpToggle.checked).toBe(true);
    });

    it('returns mcpIntegrationEnabled as false when toggle is unchecked', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const mcpToggle: HTMLInputElement = dialog.querySelector('#mcp-integration-toggle') as HTMLInputElement;

        // Uncheck the toggle
        mcpToggle.checked = false;

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.mcpIntegrationEnabled).toBe(false);
    });

    // New tests for agent prompt functionality
    it('displays the agent prompt in an editable textarea', async () => {
        const agentPrompt: string = 'Custom agent prompt for testing';
        void showAgentCommandEditor('claude test', agentPrompt);

        const dialog: HTMLDialogElement = getDialog();
        const textarea: HTMLTextAreaElement = dialog.querySelector('#agent-prompt-input') as HTMLTextAreaElement;
        expect(textarea).not.toBeNull();
        expect(textarea.value).toBe(agentPrompt);
    });

    it('returns modified agent prompt on Run click', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const textarea: HTMLTextAreaElement = dialog.querySelector('#agent-prompt-input') as HTMLTextAreaElement;
        textarea.value = 'Modified agent prompt';

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.agentPrompt).toBe('Modified agent prompt');
    });

    it('returns both modified command and agent prompt', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const commandInput: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const promptTextarea: HTMLTextAreaElement = dialog.querySelector('#agent-prompt-input') as HTMLTextAreaElement;

        commandInput.value = 'claude modified';
        promptTextarea.value = 'Modified prompt';

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.command).toBe('claude modified');
        expect(result!.agentPrompt).toBe('Modified prompt');
    });

    // Docker toggle tests
    it('has Docker toggle element in the dialog', async () => {
        void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;
        expect(dockerToggle).not.toBeNull();
    });

    it('Docker toggle is unchecked by default', async () => {
        void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;
        expect(dockerToggle.checked).toBe(false);
    });

    it('Docker toggle replaces command with Docker command when checked', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

        expect(input.value).toBe('claude test');

        // Check the Docker toggle
        dockerToggle.checked = true;
        dockerToggle.dispatchEvent(new Event('change'));

        // Verify command was replaced with Docker command
        expect(input.value).toBe(DOCKER_COMMAND_TEMPLATE);

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.command).toBe(DOCKER_COMMAND_TEMPLATE);
        expect(result!.useDocker).toBe(true);
    });

    it('Docker toggle restores original command when unchecked', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

        // Check then uncheck the Docker toggle
        dockerToggle.checked = true;
        dockerToggle.dispatchEvent(new Event('change'));
        expect(input.value).toBe(DOCKER_COMMAND_TEMPLATE);

        dockerToggle.checked = false;
        dockerToggle.dispatchEvent(new Event('change'));

        // Verify original command was restored
        expect(input.value).toBe('claude test');

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.command).toBe('claude test');
        expect(result!.useDocker).toBe(false);
    });

    it('Docker toggle enables auto-run toggle when checked', async () => {
        void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const autoRunToggle: HTMLInputElement = dialog.querySelector('[data-testid="auto-run-toggle"]') as HTMLInputElement;
        const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

        expect(autoRunToggle.checked).toBe(false);

        // Check the Docker toggle
        dockerToggle.checked = true;
        dockerToggle.dispatchEvent(new Event('change'));

        // Verify auto-run toggle is now checked (Docker command has --dangerously-skip-permissions)
        expect(autoRunToggle.checked).toBe(true);
    });

    it('returns useDocker as false when not using Docker', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.useDocker).toBe(false);
    });

    // Worktree toggle tests
    describe('Worktree toggle', () => {
        it('has Worktree toggle element in the dialog', async () => {
            void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

            const dialog: HTMLDialogElement = getDialog();
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;
            expect(worktreeToggle).not.toBeNull();
        });

        it('Worktree toggle is unchecked by default', async () => {
            void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

            const dialog: HTMLDialogElement = getDialog();
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;
            expect(worktreeToggle.checked).toBe(false);
        });

        it('Worktree toggle prepends git worktree command when checked', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT, 'my-test-task');

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;

            expect(input.value).toBe('claude test');

            // Check the Worktree toggle
            worktreeToggle.checked = true;
            worktreeToggle.dispatchEvent(new Event('change'));

            // Verify worktree prefix was prepended
            expect(input.value).toMatch(/^git worktree add -b "wt-my-test-task-[a-z0-9]{4}" "\.worktrees\/wt-my-test-task-[a-z0-9]{4}" && cd "\.worktrees\/wt-my-test-task-[a-z0-9]{4}" && claude test$/);

            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            // Worktree prefix is now embedded in the command string
            expect(result!.command).toMatch(/^git worktree add/);
        });

        it('Worktree toggle removes prefix when unchecked', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT, 'test-task');

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;

            // Check then uncheck the Worktree toggle
            worktreeToggle.checked = true;
            worktreeToggle.dispatchEvent(new Event('change'));
            expect(input.value).toMatch(/^git worktree add/);

            worktreeToggle.checked = false;
            worktreeToggle.dispatchEvent(new Event('change'));

            // Verify original command was restored
            expect(input.value).toBe('claude test');

            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            // Command should not have worktree prefix
            expect(result!.command).toBe('claude test');
        });

        it('returns command without worktree prefix when worktree not enabled', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

            const dialog: HTMLDialogElement = getDialog();
            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            expect(result!.command).toBe('claude test');
            expect(result!.command).not.toMatch(/^git worktree/);
        });
    });

    // Checkbox combination tests - order-invariant behavior
    describe('Checkbox combinations', () => {
        it('Auto-run + Worktree: both are applied correctly', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT, 'combo-task');

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const autoRunToggle: HTMLInputElement = dialog.querySelector('[data-testid="auto-run-toggle"]') as HTMLInputElement;
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;

            // Enable auto-run first
            autoRunToggle.checked = true;
            autoRunToggle.dispatchEvent(new Event('change'));
            expect(input.value).toBe(`claude ${AUTO_RUN_FLAG} test`);

            // Then enable worktree
            worktreeToggle.checked = true;
            worktreeToggle.dispatchEvent(new Event('change'));

            // Should have both: worktree prefix AND auto-run flag
            expect(input.value).toMatch(/^git worktree add.*&& claude --dangerously-skip-permissions test$/);

            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            expect(result!.command).toMatch(/^git worktree add/);
            expect(result!.command).toContain(AUTO_RUN_FLAG);
        });

        it('Worktree first, then Docker: order-invariant - both are combined', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT, 'test-task');

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;
            const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

            // Enable worktree first
            worktreeToggle.checked = true;
            worktreeToggle.dispatchEvent(new Event('change'));
            expect(input.value).toMatch(/^git worktree add/);

            // Then enable Docker - should combine both (order-invariant)
            dockerToggle.checked = true;
            dockerToggle.dispatchEvent(new Event('change'));

            // Command should have worktree prefix + docker command
            expect(input.value).toMatch(/^git worktree add/);
            expect(input.value).toContain('docker build');

            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            expect(result!.command).toMatch(/^git worktree add.*docker build/);
            expect(result!.useDocker).toBe(true);
        });

        it('Worktree first then Docker, then uncheck Docker: worktree-prefixed original command is restored', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT, 'test-task');

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;
            const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

            // Enable worktree first
            worktreeToggle.checked = true;
            worktreeToggle.dispatchEvent(new Event('change'));
            const worktreePrefixedOriginal: string = input.value;
            expect(worktreePrefixedOriginal).toMatch(/^git worktree add.*claude test$/);

            // Then enable Docker
            dockerToggle.checked = true;
            dockerToggle.dispatchEvent(new Event('change'));
            expect(input.value).toMatch(/^git worktree add.*docker build/);

            // Uncheck Docker
            dockerToggle.checked = false;
            dockerToggle.dispatchEvent(new Event('change'));

            // The worktree-prefixed original command should be restored
            expect(input.value).toBe(worktreePrefixedOriginal);

            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            expect(result!.command).toBe(worktreePrefixedOriginal);
            expect(result!.useDocker).toBe(false);
        });

        it('Docker first, then Worktree: order-invariant - same result as Worktree first', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT, 'test-task');

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;
            const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

            // Enable Docker first
            dockerToggle.checked = true;
            dockerToggle.dispatchEvent(new Event('change'));
            expect(input.value).toBe(DOCKER_COMMAND_TEMPLATE);

            // Then enable Worktree
            worktreeToggle.checked = true;
            worktreeToggle.dispatchEvent(new Event('change'));

            // Worktree prefix should be prepended to Docker command
            expect(input.value).toMatch(/^git worktree add/);
            expect(input.value).toContain(DOCKER_COMMAND_TEMPLATE);

            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            // Command has both: worktree prefix AND docker command
            expect(result!.command).toMatch(/^git worktree add.*docker build/);
            expect(result!.useDocker).toBe(true);
        });

        it('All toggles enabled (MCP, Auto-run, Worktree, Docker): order Docker→Worktree', async () => {
            const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT, 'all-toggles');

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const mcpToggle: HTMLInputElement = dialog.querySelector('#mcp-integration-toggle') as HTMLInputElement;
            const autoRunToggle: HTMLInputElement = dialog.querySelector('[data-testid="auto-run-toggle"]') as HTMLInputElement;
            const worktreeToggle: HTMLInputElement = dialog.querySelector('[data-testid="worktree-toggle"]') as HTMLInputElement;
            const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

            // MCP is on by default
            expect(mcpToggle.checked).toBe(true);

            // Enable Docker (also enables auto-run)
            dockerToggle.checked = true;
            dockerToggle.dispatchEvent(new Event('change'));
            expect(autoRunToggle.checked).toBe(true);

            // Enable Worktree
            worktreeToggle.checked = true;
            worktreeToggle.dispatchEvent(new Event('change'));

            // Final command should have worktree prefix + docker command
            expect(input.value).toMatch(/^git worktree add.*docker build/);

            const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
            form.dispatchEvent(new Event('submit', { cancelable: true }));

            const result: AgentCommandEditorResult | null = await promise;
            expect(result).not.toBeNull();
            expect(result!.mcpIntegrationEnabled).toBe(true);
            expect(result!.command).toMatch(/^git worktree add.*docker build/);
            expect(result!.useDocker).toBe(true);
        });

        it('Docker + Auto-run toggle interaction: unchecking auto-run removes flag from Docker command', async () => {
            void showAgentCommandEditor('claude test', DEFAULT_AGENT_PROMPT);

            const dialog: HTMLDialogElement = getDialog();
            const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
            const autoRunToggle: HTMLInputElement = dialog.querySelector('[data-testid="auto-run-toggle"]') as HTMLInputElement;
            const dockerToggle: HTMLInputElement = dialog.querySelector('[data-testid="docker-toggle"]') as HTMLInputElement;

            // Enable Docker (enables auto-run automatically)
            dockerToggle.checked = true;
            dockerToggle.dispatchEvent(new Event('change'));
            expect(autoRunToggle.checked).toBe(true);
            expect(input.value).toContain(AUTO_RUN_FLAG);

            // Uncheck auto-run manually
            autoRunToggle.checked = false;
            autoRunToggle.dispatchEvent(new Event('change'));

            // Flag should be removed from the Docker command
            expect(input.value).not.toContain(AUTO_RUN_FLAG);
        });
    });
});
