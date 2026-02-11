import type { Extension } from '@codemirror/state';
import type {} from "@/shell/electron"; // Import ElectronAPI type for window.electronAPI access
import { EditorView } from '@codemirror/view';
import { startCompletion } from '@codemirror/autocomplete';
import ctxmenu from '@/shell/UI/lib/ctxmenu.js';

/**
 * Insert wikilink brackets at cursor and trigger autocomplete.
 * Inserts [[]], positions cursor between brackets, and opens node picker.
 */
function insertWikilinkAndTriggerCompletion(view: EditorView): void {
  const cursor: number = view.state.selection.main.head;

  // Insert [[]] and position cursor between the brackets
  view.dispatch({
    changes: { from: cursor, insert: '[[]]' },
    selection: { anchor: cursor + 2 }, // Position cursor after [[
    userEvent: 'input'
  });

  // Focus the editor and trigger autocomplete
  view.focus();

  // Use requestAnimationFrame to ensure the DOM update completes before triggering autocomplete
  requestAnimationFrame(() => {
    startCompletion(view);
  });
}

/**
 * Create paste handler for images from clipboard.
 * When an image is pasted:
 * 1. Calls saveClipboardImage IPC to save image as sibling file
 * 2. Inserts markdown image reference ![[filename.png]] at cursor
 */
export function createImagePasteHandler(nodeId: string | undefined): Extension {
  return EditorView.domEventHandlers({
    paste: (event: ClipboardEvent, view: EditorView): boolean => {
      // Only handle if we have a nodeId configured
      if (!nodeId) {
        return false; // Let default paste handling continue
      }

      // Check if clipboard contains an image
      const clipboardData: DataTransfer | null = event.clipboardData;
      if (!clipboardData) {
        return false;
      }

      // Check for image data in clipboard items
      const hasImage: boolean = Array.from(clipboardData.items).some(
        (item: DataTransferItem) => item.type.startsWith('image/')
      );

      if (!hasImage) {
        return false; // No image, let default paste handling continue
      }

      // Prevent default paste behavior for images
      event.preventDefault();

      // Call saveClipboardImage IPC to save the image
      const capturedNodeId: string = nodeId;
      void (async (): Promise<void> => {
        try {
          const filename: string | null = await window.electronAPI?.main.saveClipboardImage(capturedNodeId) ?? null;

          if (filename) {
            // Insert markdown image reference at cursor position
            const imageRef: string = `![[${filename}]]`;
            const cursor: number = view.state.selection.main.head;
            view.dispatch({
              changes: { from: cursor, insert: imageRef },
              selection: { anchor: cursor + imageRef.length },
              userEvent: 'input.paste'
            });
            //console.log('[CodeMirrorEditorView] Pasted image:', filename);
          } else {
            //console.log('[CodeMirrorEditorView] No image in clipboard');
          }
        } catch (error) {
          console.error('[CodeMirrorEditorView] Error saving pasted image:', error);
        }
      })();

      return true; // We handled the paste event
    }
  });
}

/**
 * Create context menu handler for right-click actions in the editor.
 * Shows a menu with "Add Link" option to insert wikilink and trigger autocomplete.
 */
export function createContextMenuHandler(language: string | undefined): Extension {
  return EditorView.domEventHandlers({
    contextmenu: (event: MouseEvent, view: EditorView): boolean => {
      // Only handle in markdown mode (not JSON)
      if (language === 'json') {
        return false;
      }

      event.preventDefault();

      const menuItems: Array<{ text?: string; html?: string; action?: () => void }> = [
        {
          html: '<span style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">🔗 Add Link</span>',
          action: () => {
            insertWikilinkAndTriggerCompletion(view);
          },
        },
      ];

      ctxmenu.show(menuItems, event);
      return true;
    }
  });
}
