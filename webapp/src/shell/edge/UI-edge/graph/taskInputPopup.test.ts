/**
 * Unit tests for Task Input Popup
 *
 * Tests the showTaskInputPopup function that displays an HTML dialog
 * for entering a task description before spawning an agent on selected nodes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showTaskInputPopup, type TaskInputResult } from './taskInputPopup';

describe('showTaskInputPopup', () => {
    let mockShowModal: ReturnType<typeof vi.fn>;
    let mockClose: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockShowModal = vi.fn();
        mockClose = vi.fn(function (this: HTMLDialogElement) {
            this.dispatchEvent(new Event('close'));
        });

        HTMLDialogElement.prototype.showModal = mockShowModal;
        HTMLDialogElement.prototype.close = mockClose;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.querySelectorAll('dialog').forEach((d: Element) => d.remove());
    });

    function getDialog(): HTMLDialogElement {
        const dialog: HTMLDialogElement | null = document.querySelector('#task-input-dialog');
        if (!dialog) throw new Error('Dialog not found');
        return dialog;
    }

    // Test: Task input popup appears on menu click
    it('displays popup with task description textarea', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'First Node' },
        ];
        void showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        expect(mockShowModal).toHaveBeenCalled();

        const textarea: HTMLTextAreaElement | null = dialog.querySelector('[data-testid="task-description-input"]');
        expect(textarea).not.toBeNull();
    });

    // Test: Popup shows selected node titles for user reference
    it('displays selected node titles in popup', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'First Node' },
            { id: 'node2', title: 'Second Node' },
            { id: 'node3', title: 'Third Node' },
        ];
        void showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        const nodeList: HTMLElement | null = dialog.querySelector('[data-testid="selected-nodes-list"]');
        expect(nodeList).not.toBeNull();
        expect(nodeList!.textContent).toContain('First Node');
        expect(nodeList!.textContent).toContain('Second Node');
        expect(nodeList!.textContent).toContain('Third Node');
    });

    // Test: Returns task description on confirm
    it('returns task description on confirm click', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'Test Node' },
        ];
        const promise: Promise<TaskInputResult | null> = showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        const textarea: HTMLTextAreaElement = dialog.querySelector('[data-testid="task-description-input"]') as HTMLTextAreaElement;
        textarea.value = 'Implement the login feature';

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: TaskInputResult | null = await promise;
        expect(result).not.toBeNull();
        expect(result!.taskDescription).toBe('Implement the login feature');
    });

    // Test: User cancels popup - no action taken
    it('returns null on cancel click', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'Test Node' },
        ];
        const promise: Promise<TaskInputResult | null> = showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        const cancelButton: HTMLButtonElement = dialog.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement;
        cancelButton.click();

        const result: TaskInputResult | null = await promise;
        expect(result).toBeNull();
    });

    // Test: Empty task description returns null on confirm
    it('returns null when confirming with empty task description', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'Test Node' },
        ];
        const promise: Promise<TaskInputResult | null> = showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        const textarea: HTMLTextAreaElement = dialog.querySelector('[data-testid="task-description-input"]') as HTMLTextAreaElement;
        textarea.value = '   '; // whitespace only

        const form: HTMLFormElement = dialog.querySelector('form') as HTMLFormElement;
        form.dispatchEvent(new Event('submit', { cancelable: true }));

        const result: TaskInputResult | null = await promise;
        expect(result).toBeNull();
    });

    // Test: Confirm button is disabled when textarea is empty
    it('confirm button is disabled when textarea is empty', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'Test Node' },
        ];
        void showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        const confirmButton: HTMLButtonElement = dialog.querySelector('[data-testid="confirm-button"]') as HTMLButtonElement;

        expect(confirmButton.disabled).toBe(true);
    });

    // Test: Confirm button becomes enabled when text is entered
    it('confirm button enables when text is entered', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'Test Node' },
        ];
        void showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        const textarea: HTMLTextAreaElement = dialog.querySelector('[data-testid="task-description-input"]') as HTMLTextAreaElement;
        const confirmButton: HTMLButtonElement = dialog.querySelector('[data-testid="confirm-button"]') as HTMLButtonElement;

        textarea.value = 'Some task';
        textarea.dispatchEvent(new Event('input'));

        expect(confirmButton.disabled).toBe(false);
    });

    // Test: Dialog shows selection count in header
    it('shows selection count in header', async () => {
        const selectedNodes: Array<{ id: string; title: string }> = [
            { id: 'node1', title: 'First' },
            { id: 'node2', title: 'Second' },
        ];
        void showTaskInputPopup(selectedNodes);

        const dialog: HTMLDialogElement = getDialog();
        const header: HTMLElement | null = dialog.querySelector('h2');
        expect(header).not.toBeNull();
        expect(header!.textContent).toContain('2');
    });
});
