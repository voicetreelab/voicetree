/**
 * Minimal CodeMirror 6 factory for inline card editing.
 *
 * Stripped-down config: markdown syntax + wikilink autocomplete/display + autosave.
 * NO line numbers, NO menu bar, NO vim, NO mermaid/video preview.
 *
 * Registers in vanillaFloatingWindowInstances for EditorSync compatibility.
 */
import { EditorState, type Extension } from '@codemirror/state';
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
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';
import type { NodeIdAndFilePath } from '@/pure/graph';

// Track mounted inline editors for unmount + EditorSync
const inlineEditors: Map<string, InlineEditorInstance> = new Map();

interface InlineEditorInstance {
    readonly view: EditorView;
    readonly container: HTMLElement;
    readonly editorId: string;
    readonly disposeUpdateListener: () => void;
    readonly changeEmitter: EventEmitter<string>;
    readonly anyDocChangeEmitter: EventEmitter<void>;
    readonly geometryChangeEmitter: EventEmitter<void>;
}

/**
 * Mount a minimal CodeMirror editor into a container element.
 * Returns a cleanup unsubscribe for the onChange handler.
 */
export function mountInlineEditor(
    container: HTMLElement,
    content: string,
    nodeId: NodeIdAndFilePath,
    onContentChange: (newContent: string) => void
): void {
    // Prevent double-mount
    if (inlineEditors.has(nodeId)) {
        unmountInlineEditor(nodeId);
    }

    const isDarkMode: boolean = document.documentElement.classList.contains('dark');
    const editorId: string = `inline-edit:${nodeId}`;

    const changeEmitter: EventEmitter<string> = new EventEmitter<string>();
    const anyDocChangeEmitter: EventEmitter<void> = new EventEmitter<void>();
    const geometryChangeEmitter: EventEmitter<void> = new EventEmitter<void>();

    const updateListener: { extension: Extension; dispose: () => void } = createUpdateListener({
        autosaveDelay: 300,
        changeEmitter,
        anyDocChangeEmitter,
        geometryChangeEmitter,
        container,
    });

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
        updateListener.extension,
        createImagePasteHandler(nodeId),
        ...(isDarkMode ? [oneDark] : []),
    ];

    if (isDarkMode) {
        container.setAttribute('data-color-mode', 'dark');
    }

    const state: EditorState = EditorState.create({ doc: content, extensions });
    const view: EditorView = new EditorView({ state, parent: container });

    // Wire onChange → autosave
    const unsubChange: () => void = changeEmitter.on(onContentChange);

    const instance: InlineEditorInstance = {
        view,
        container,
        editorId,
        disposeUpdateListener: updateListener.dispose,
        changeEmitter,
        anyDocChangeEmitter,
        geometryChangeEmitter,
    };

    inlineEditors.set(nodeId, instance);

    // Register in vanillaFloatingWindowInstances for EditorSync compatibility
    vanillaFloatingWindowInstances.set(editorId, {
        dispose: () => unmountInlineEditor(nodeId),
        focus: () => view.focus(),
        getValue: () => view.state.doc.toString(),
        setValue: (newContent: string) => {
            const cursorPos: number = view.state.selection.main.head;
            const clampedPos: number = Math.min(cursorPos, newContent.length);
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: newContent },
                selection: { anchor: clampedPos },
            });
        },
    } as { dispose: () => void; focus: () => void });

    // Store unsubscribe on instance for cleanup
    (instance as { unsubChange?: () => void }).unsubChange = unsubChange;
}

/**
 * Unmount and dispose the inline editor for a node.
 */
export function unmountInlineEditor(nodeId: string): void {
    const instance: InlineEditorInstance | undefined = inlineEditors.get(nodeId);
    if (!instance) return;

    // Unregister from EditorSync
    vanillaFloatingWindowInstances.delete(instance.editorId);

    // Dispose update listener (clears debounce timers)
    instance.disposeUpdateListener();

    // Destroy CodeMirror view
    instance.view.destroy();

    // Clear emitters
    instance.changeEmitter.clear();
    instance.anyDocChangeEmitter.clear();
    instance.geometryChangeEmitter.clear();

    // Unsubscribe onChange
    const unsub: (() => void) | undefined = (instance as { unsubChange?: () => void }).unsubChange;
    if (unsub) unsub();

    // Clear container DOM
    instance.container.innerHTML = '';

    inlineEditors.delete(nodeId);
}

/**
 * Check if a node has an active inline editor.
 */
export function hasInlineEditor(nodeId: string): boolean {
    return inlineEditors.has(nodeId);
}

/**
 * Focus the inline editor for a node (if mounted).
 */
export function focusInlineEditor(nodeId: string): void {
    const instance: InlineEditorInstance | undefined = inlineEditors.get(nodeId);
    if (instance) {
        instance.view.focus();
    }
}

/**
 * Focus at end of document in the inline editor (for new nodes).
 */
export function focusInlineEditorAtEnd(nodeId: string): void {
    const instance: InlineEditorInstance | undefined = inlineEditors.get(nodeId);
    if (instance) {
        const docLength: number = instance.view.state.doc.length;
        instance.view.dispatch({ selection: { anchor: docLength } });
        instance.view.focus();
    }
}

/**
 * Get the inline editor ID string for a node (for EditorSync registration).
 */
export function getInlineEditorId(nodeId: string): string {
    return `inline-edit:${nodeId}`;
}
