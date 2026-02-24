/**
 * CardCM — read-only CodeMirror 6 mount for node cards, with Compartment-based mode switching.
 *
 * Mounts once, reconfigures between read-only and editing modes via CM6 Compartment dispatch.
 * No DOM teardown on edit toggle — preserves scroll position and undo history.
 *
 * Does NOT register in vanillaFloatingWindowInstances (@deprecated).
 * EditorSync accesses instances via getCardCM(nodeId).view directly.
 */
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { indentMore, indentLess } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { acceptCompletion } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { wikilinkCompletion } from '@/shell/UI/floating-windows/extensions/wikilinkCompletion';
import { wikilinkTitleDisplay } from '@/shell/UI/floating-windows/extensions/wikilinkTitleDisplay';
import { createMarkdownExtensions } from '@/shell/UI/floating-windows/editors/markdownExtensions';
import { createUpdateListener } from '@/shell/UI/floating-windows/editors/updateListener';
import { createImagePasteHandler } from '@/shell/UI/floating-windows/editors/editorDomHandlers';
import { EventEmitter } from '@/utils/EventEmitter';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { CardCMInstance, CardCMMode } from '@/pure/graph/node-presentation/cardCMTypes';

// Module-scoped Map — same pattern as inlineEditor.ts
const cardCMInstances: Map<string, CardCMInstance> = new Map();

// Transient edit-mode resources stored outside CardCMInstance to avoid widening the interface type
interface EditCleanupEntry {
    readonly cleanup: () => void;
}
const editCleanups: Map<string, EditCleanupEntry> = new Map();

/**
 * Mount a read-only CodeMirror into a card container.
 * Creates CM with Compartments pre-wired for future mode switching.
 * If already mounted for this nodeId, unmounts first (prevents double-mount).
 */
export function mountCardCM(container: HTMLElement, content: string, nodeId: string): void {
    // Prevent double-mount — same guard as inlineEditor.ts
    if (cardCMInstances.has(nodeId)) {
        unmountCardCM(nodeId);
    }

    const isDarkMode: boolean = document.documentElement.classList.contains('dark');

    // Two Compartments created at mount time — the key to zero-cost mode switching
    const editableCompartment: Compartment = new Compartment();
    const autosaveCompartment: Compartment = new Compartment();

    const extensions: Extension[] = [
        basicSetup,
        keymap.of([
            { key: 'Tab', run: (view: EditorView) => acceptCompletion(view) || indentMore(view) },
            { key: 'Shift-Tab', run: indentLess },
        ]),
        ...createMarkdownExtensions(),
        wikilinkCompletion(),
        wikilinkTitleDisplay(),
        tooltips({ parent: document.body }),
        EditorView.lineWrapping,
        // Read-only by default — CSS hides gutters/cursor in card mode
        editableCompartment.of([EditorView.editable.of(false), EditorState.readOnly.of(true)]),
        // No autosave in read-only mode — Compartment starts empty
        autosaveCompartment.of([]),
        ...(isDarkMode ? [oneDark] : []),
    ];

    if (isDarkMode) {
        container.setAttribute('data-color-mode', 'dark');
    }

    const state: EditorState = EditorState.create({ doc: content, extensions });
    const view: EditorView = new EditorView({ state, parent: container });

    const instance: CardCMInstance = {
        view,
        container,
        editableCompartment,
        autosaveCompartment,
        nodeId,
        currentMode: 'readonly',
    };

    cardCMInstances.set(nodeId, instance);
}

/**
 * Reconfigure a mounted CardCM between readonly and editing modes.
 * Uses CM6 Compartment dispatch — no DOM rebuild, preserves scroll position and undo history.
 * In 'editing' mode, onContentChange receives debounced content updates on user edits.
 */
export function reconfigureCardCM(
    nodeId: string,
    mode: CardCMMode,
    onContentChange?: (content: string) => void
): void {
    const inst: CardCMInstance | undefined = cardCMInstances.get(nodeId);
    // No-op if not mounted or already in the target mode
    if (!inst || inst.currentMode === mode) return;

    if (mode === 'editing') {
        // Wire EventEmitters — same pattern as inlineEditor.ts
        const changeEmitter: EventEmitter<string> = new EventEmitter<string>();
        const anyDocChangeEmitter: EventEmitter<void> = new EventEmitter<void>();
        const geometryChangeEmitter: EventEmitter<void> = new EventEmitter<void>();

        const updateListener: { extension: Extension; dispose: () => void } = createUpdateListener({
            autosaveDelay: 300,
            changeEmitter,
            anyDocChangeEmitter,
            geometryChangeEmitter,
            container: inst.container,
        });

        // Wire the caller's content-change callback
        let unsubChange: (() => void) | undefined;
        if (onContentChange) {
            unsubChange = changeEmitter.on(onContentChange);
        }

        // Single dispatch to atomically flip both Compartments
        inst.view.dispatch({
            effects: [
                inst.editableCompartment.reconfigure([
                    EditorView.editable.of(true),
                    EditorState.readOnly.of(false),
                ]),
                inst.autosaveCompartment.reconfigure([
                    updateListener.extension,
                    createImagePasteHandler(nodeId as NodeIdAndFilePath),
                ]),
            ],
        });

        // Store cleanup for when we switch back to readonly
        editCleanups.set(nodeId, {
            cleanup: (): void => {
                updateListener.dispose();
                if (unsubChange) unsubChange();
                changeEmitter.clear();
                anyDocChangeEmitter.clear();
                geometryChangeEmitter.clear();
            },
        });
    } else {
        // Switching back to readonly — clean up edit-mode resources
        const entry: EditCleanupEntry | undefined = editCleanups.get(nodeId);
        if (entry) {
            entry.cleanup();
            editCleanups.delete(nodeId);
        }

        inst.view.dispatch({
            effects: [
                inst.editableCompartment.reconfigure([
                    EditorView.editable.of(false),
                    EditorState.readOnly.of(true),
                ]),
                // Unwire autosave — empty Compartment = no update listener
                inst.autosaveCompartment.reconfigure([]),
            ],
        });
    }

    inst.currentMode = mode;
}

/**
 * Unmount and destroy a CardCM instance.
 * Cleans up edit-mode resources if currently editing, then destroys the CM view.
 */
export function unmountCardCM(nodeId: string): void {
    const inst: CardCMInstance | undefined = cardCMInstances.get(nodeId);
    if (!inst) return;

    // Clean up edit-mode resources if currently editing
    if (inst.currentMode === 'editing') {
        const entry: EditCleanupEntry | undefined = editCleanups.get(nodeId);
        if (entry) {
            entry.cleanup();
            editCleanups.delete(nodeId);
        }
    }

    // Destroy the CodeMirror view
    inst.view.destroy();

    // Clear container DOM
    inst.container.innerHTML = '';

    cardCMInstances.delete(nodeId);
}

/**
 * Get a CardCM instance by node ID.
 * Used by EditorSync to access view.dispatch() for external content updates.
 */
export function getCardCM(nodeId: string): CardCMInstance | undefined {
    return cardCMInstances.get(nodeId);
}
