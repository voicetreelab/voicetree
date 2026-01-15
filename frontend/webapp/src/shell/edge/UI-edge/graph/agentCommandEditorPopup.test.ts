/**
 * Unit tests for Agent Command Editor Popup
 *
 * Tests the showAgentCommandEditor function that displays an HTML dialog
 * for editing agent commands and prompts before execution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showAgentCommandEditor, AUTO_RUN_FLAG, type AgentCommandEditorResult } from './agentCommandEditorPopup';

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

    // 4.3 Unit Test: "Add auto-run" button appends --dangerously-skip-permissions flag
    it('Add auto-run button appends --dangerously-skip-permissions flag and preserves rest of command', async () => {
        const promise: Promise<AgentCommandEditorResult | null> = showAgentCommandEditor('claude "$AGENT_PROMPT"', DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const addAutoRunButton: HTMLButtonElement = dialog.querySelector('[data-testid="add-auto-run-button"]') as HTMLButtonElement;

        expect(input.value).toBe('claude "$AGENT_PROMPT"');
        expect(addAutoRunButton).not.toBeNull();
        expect(addAutoRunButton.disabled).toBe(false);

        // Click Add auto-run button
        addAutoRunButton.click();

        // Verify flag was added AND original argument is preserved
        expect(input.value).toBe(`claude ${AUTO_RUN_FLAG} "$AGENT_PROMPT"`);

        // Click Run to get the result
        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: AgentCommandEditorResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.command).toBe(`claude ${AUTO_RUN_FLAG} "$AGENT_PROMPT"`);
    });

    // 4.4 Unit Test: "Add auto-run" button disabled when flag already present
    it('Add auto-run button disabled when flag already present', async () => {
        const commandWithFlag: string = `claude ${AUTO_RUN_FLAG} test`;
        void showAgentCommandEditor(commandWithFlag, DEFAULT_AGENT_PROMPT);

        const dialog: HTMLDialogElement = getDialog();
        const input: HTMLInputElement = dialog.querySelector('#command-input') as HTMLInputElement;
        const addAutoRunButton: HTMLButtonElement = dialog.querySelector('[data-testid="add-auto-run-button"]') as HTMLButtonElement;

        expect(input.value).toBe(commandWithFlag);
        expect(addAutoRunButton.disabled).toBe(true);
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
        expect(dialog.querySelector('[data-testid="add-auto-run-button"]')).not.toBeNull();
        expect(dialog.querySelector('[data-testid="cancel-button"]')).not.toBeNull();
        expect(dialog.querySelector('[data-testid="run-button"]')).not.toBeNull();
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
});
