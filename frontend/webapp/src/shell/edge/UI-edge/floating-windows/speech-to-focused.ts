/**
 * Speech-to-Focused: Routes speech text to focused editor or terminal
 *
 * Pure functions for detecting focus and routing text input.
 * Uses DOM as source of truth - no state management needed.
 */

import { EditorView } from '@codemirror/view';
import type { ElectronAPI } from '@/shell/electron';

type FocusedWindow = {
  type: 'editor' | 'terminal';
  id: string;
};

/**
 * Detect which floating window (editor or terminal) currently has focus.
 * Uses document.activeElement and DOM traversal.
 */
export function getFocusedFloatingWindow(): FocusedWindow | null {
  const active: Element | null = document.activeElement;
  if (!active) return null;

  const floatingWindow: Element | null = active.closest('[data-floating-window-id]');
  if (!floatingWindow) return null;

  const id: string | null = floatingWindow.getAttribute('data-floating-window-id');
  if (!id) return null;

  if (active.closest('.cm-editor')) {
    return { type: 'editor', id };
  }
  if (active.closest('.xterm')) {
    return { type: 'terminal', id };
  }

  return null;
}

/**
 * Get the CodeMirror EditorView from the currently focused element.
 * Uses CodeMirror's findFromDOM - no instance registry needed.
 */
function getEditorViewFromDOM(): EditorView | null {
  const active: Element | null = document.activeElement;
  if (!active) return null;

  const cmEditor: Element | null = active.closest('.cm-editor');
  if (!cmEditor || !(cmEditor instanceof HTMLElement)) return null;

  // CodeMirror 6 stores the view on the DOM element
  return EditorView.findFromDOM(cmEditor);
}

/**
 * Insert text at the current cursor position in a CodeMirror view.
 */
function insertTextAtCursor(view: EditorView, text: string): void {
  const cursor: number = view.state.selection.main.head;
  view.dispatch({
    changes: { from: cursor, insert: text },
    selection: { anchor: cursor + text.length }
  });
}

/**
 * Route speech text to the currently focused editor or terminal.
 * Returns true if text was routed, false if nothing was focused.
 *
 * This is the main entry point - a "deep function" that hides complexity.
 */
export function routeSpeechToFocused(text: string): boolean {
  const focused: FocusedWindow | null = getFocusedFloatingWindow();
  if (!focused) return false;

  if (focused.type === 'editor') {
    const view: EditorView | null = getEditorViewFromDOM();
    if (view) {
      insertTextAtCursor(view, text);
      return true;
    }
  } else if (focused.type === 'terminal') {
    // Write directly to terminal PTY via electron IPC
    const electronAPI: ElectronAPI | undefined = window.electronAPI;
    if (electronAPI) {
      void electronAPI.terminal.write(focused.id, text);
    }
    return true;
  }

  return false;
}
