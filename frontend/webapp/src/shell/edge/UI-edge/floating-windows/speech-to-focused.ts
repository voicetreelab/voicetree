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

// State for active transcription preview chip
let activePreview: {
  element: HTMLElement;
  cleanup: () => void;
  resolve: (inserted: boolean) => void;
  target: { type: 'editor'; view: EditorView } | { type: 'terminal'; id: string };
  currentText: string;
} | null = null;

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

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const div: HTMLDivElement = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Truncate text with ellipsis if longer than maxLength
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Get cursor position coordinates for editor or terminal
 */
function getCursorPosition(target: { type: 'editor'; view: EditorView } | { type: 'terminal'; id: string }): { x: number; y: number } | null {
  if (target.type === 'editor') {
    const coords = target.view.coordsAtPos(target.view.state.selection.main.head);
    if (coords) {
      return { x: coords.left, y: coords.top };
    }
  } else {
    // Terminal: position above the terminal input area (bottom of terminal)
    const terminalElement: Element | null = document.querySelector(`[data-floating-window-id="${target.id}"] .xterm`);
    if (terminalElement) {
      const rect: DOMRect = terminalElement.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.bottom - 30 };
    }
  }
  return null;
}

/**
 * Dismiss any active transcription preview without resolving (for cleanup)
 */
function cleanupActivePreview(): void {
  if (activePreview) {
    activePreview.cleanup();
    activePreview.element.remove();
  }
}

/**
 * Dismiss any active transcription preview, resolving with false (cancelled)
 */
export function dismissTranscriptionPreview(): void {
  if (activePreview) {
    const preview = activePreview;
    activePreview = null;
    preview.cleanup();
    preview.element.remove();
    preview.resolve(false);
  }
}

/**
 * Update the text in an active transcription preview chip.
 * Returns true if chip was updated, false if no active chip exists.
 */
export function updateTranscriptionPreview(newText: string): boolean {
  if (!activePreview) return false;

  activePreview.currentText = newText;

  // Update the displayed text
  const textSpan: Element | null = activePreview.element.querySelector('.preview-text');
  if (textSpan) {
    textSpan.textContent = truncate(newText, 50);
    textSpan.setAttribute('title', newText);
  }

  return true;
}

/**
 * Check if there's an active transcription preview
 */
export function hasActiveTranscriptionPreview(): boolean {
  return activePreview !== null;
}

/**
 * Confirm the active transcription preview (insert text).
 * Returns true if confirmed, false if no active preview.
 */
export function confirmTranscriptionPreview(): boolean {
  if (!activePreview) return false;

  const preview = activePreview;
  activePreview = null;

  // Insert the current text
  if (preview.target.type === 'editor') {
    insertTextAtCursor(preview.target.view, preview.currentText);
  } else {
    const electronAPI: ElectronAPI | undefined = window.electronAPI;
    if (electronAPI) {
      void electronAPI.terminal.write(preview.target.id, preview.currentText);
    }
  }

  preview.cleanup();
  preview.element.remove();
  preview.resolve(true);

  return true;
}

/**
 * Show transcription preview chip above cursor.
 * Returns promise that resolves to true (inserted) or false (dismissed).
 *
 * The chip can be updated with new text via updateTranscriptionPreview().
 * The promise resolves when the user confirms (Enter) or dismisses (Escape/click/timeout).
 */
export function showTranscriptionPreview(
  text: string,
  target: { type: 'editor'; view: EditorView } | { type: 'terminal'; id: string }
): Promise<boolean> {
  return new Promise((resolve) => {
    // 1. Clean up any existing preview (but don't resolve its promise - we're replacing it)
    cleanupActivePreview();
    activePreview = null;

    // 2. Get position
    const position = getCursorPosition(target);
    if (!position) {
      resolve(false);
      return;
    }

    // 3. Create chip element
    const chip: HTMLDivElement = document.createElement('div');
    chip.className = 'transcription-preview-chip';
    chip.innerHTML = `
      <span class="preview-text" title="${escapeHtml(text)}">${escapeHtml(truncate(text, 50))}</span>
      <span class="preview-hints">↵ · Esc</span>
    `;

    // 4. Position above cursor/input
    chip.style.left = `${position.x}px`;
    chip.style.top = `${position.y - 40}px`;
    chip.style.transform = 'translateX(-50%)';

    // 5. Add to document.body
    document.body.appendChild(chip);

    // Ensure chip stays in viewport
    const chipRect: DOMRect = chip.getBoundingClientRect();
    if (chipRect.left < 0) {
      chip.style.left = `${chipRect.width / 2 + 10}px`;
    } else if (chipRect.right > window.innerWidth) {
      chip.style.left = `${window.innerWidth - chipRect.width / 2 - 10}px`;
    }
    if (chipRect.top < 0) {
      chip.style.top = `${position.y + 30}px`;
    }

    // 7. Setup keyboard listener
    const handleKeydown = (e: KeyboardEvent): void => {
      if (!activePreview) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmTranscriptionPreview();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        dismissTranscriptionPreview();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // User started typing - dismiss without inserting
        dismissTranscriptionPreview();
      }
    };

    // 8. Setup click-outside listener
    const handleClickOutside = (e: MouseEvent): void => {
      if (activePreview && !chip.contains(e.target as Node)) {
        dismissTranscriptionPreview();
      }
    };

    // 9. Setup timeout (10s)
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
      dismissTranscriptionPreview();
    }, 10000);

    // Add listeners
    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('mousedown', handleClickOutside, true);

    // Store cleanup
    const cleanup = (): void => {
      document.removeEventListener('keydown', handleKeydown, true);
      document.removeEventListener('mousedown', handleClickOutside, true);
      clearTimeout(timeoutId);
    };

    activePreview = { element: chip, cleanup, resolve, target, currentText: text };
  });
}

/**
 * Get target info for the currently focused window (for use with showTranscriptionPreview)
 */
export function getFocusedTarget(): { type: 'editor'; view: EditorView } | { type: 'terminal'; id: string } | null {
  const focused: FocusedWindow | null = getFocusedFloatingWindow();
  if (!focused) return null;

  if (focused.type === 'editor') {
    const view: EditorView | null = getEditorViewFromDOM();
    if (view) {
      return { type: 'editor', view };
    }
  } else if (focused.type === 'terminal') {
    return { type: 'terminal', id: focused.id };
  }

  return null;
}
