import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { EventEmitter } from '@/utils/EventEmitter';

export interface UpdateListenerOptions {
  autosaveDelay: number;
  changeEmitter: EventEmitter<string>;
  anyDocChangeEmitter: EventEmitter<void>;
  geometryChangeEmitter: EventEmitter<void>;
  container: HTMLElement;
}

/**
 * Create an update listener extension for content change detection.
 * Handles debounced autosave, geometry change detection, select-all CSS toggling,
 * and user vs. programmatic change discrimination.
 *
 * Returns the extension and a dispose function to clear pending debounce timeouts.
 */
export function createUpdateListener(opts: UpdateListenerOptions): { extension: Extension; dispose: () => void } {
  let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  const extension: Extension = EditorView.updateListener.of((viewUpdate: ViewUpdate) => {
    // Emit geometry changes (used by auto-height) - fires after layout is complete
    if (viewUpdate.geometryChanged) {
      opts.geometryChangeEmitter.emit();
    }

    // Detect "select all" state to apply CSS fix for CM6's extreme rectangle positioning
    // CM6 positions select-all rectangles at top:-33Mpx with height:33Mpx, ending at y=0
    // This causes the rectangle to not cover visible content. The CSS class triggers a fix.
    if (viewUpdate.selectionSet) {
      const state: EditorState = viewUpdate.state;
      const selection: { from: number; to: number } = state.selection.main;
      const isSelectAll: boolean = selection.from === 0 && selection.to === state.doc.length;
      opts.container.classList.toggle('cm-select-all', isSelectAll);
    }

    if (viewUpdate.docChanged) {
      // Emit to anyDocChangeEmitter for ALL document changes
      opts.anyDocChangeEmitter.emit();

      // Only emit to changeEmitter for user-initiated changes - not programmatic setValue() calls
      // User events: input (typing/paste), delete (backspace/del), undo, redo
      // This prevents feedback loops for autosave
      const isUserChange: boolean = viewUpdate.transactions.some(
        tr => tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("undo") || tr.isUserEvent("redo")
      );

      if (!isUserChange) {
        return; // Skip programmatic changes for autosave
      }

      // Clear existing timeout
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      // Set new timeout to emit after delay
      // Read current content at fire time, not captured content at debounce start
      // This ensures external changes (e.g., appended links) are included in the save
      debounceTimeout = setTimeout(() => {
        opts.changeEmitter.emit(viewUpdate.view.state.doc.toString());
        debounceTimeout = null;
      }, opts.autosaveDelay);
    }
  });

  return {
    extension,
    dispose: (): void => {
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
        debounceTimeout = null;
      }
    }
  };
}
