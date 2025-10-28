import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import richEditor from 'codemirror-rich-markdoc/src/index';
import { Disposable } from '@/views/Disposable';
import { EventEmitter } from '@/utils/EventEmitter';

/**
 * Configuration options for CodeMirrorEditorView
 */
export interface CodeMirrorEditorOptions {
  previewMode?: 'edit' | 'live' | 'preview';
  darkMode?: boolean;
  autosaveDelay?: number;
}

/**
 * CodeMirrorEditorView wraps CodeMirror 6 to provide a clean API for markdown editing
 * in the VoiceTree floating window system.
 *
 * Features:
 * - Rich Markdown editing with live preview (using codemirror-rich-markdoc)
 * - Markdoc support with inline rendering
 * - Change event emission
 * - Focus management
 * - Proper cleanup via Disposable pattern
 *
 * Usage:
 * ```typescript
 * const editor = new CodeMirrorEditorView(containerElement, '# Hello');
 * editor.onChange((content) => saveToFile(content));
 * editor.dispose(); // Clean up when done
 * ```
 */
export class CodeMirrorEditorView extends Disposable {
  private view: EditorView;
  private container: HTMLElement;
  private changeEmitter: EventEmitter<string>;
  private options: CodeMirrorEditorOptions;

  /**
   * Creates a new CodeMirror editor instance
   * @param container - DOM element to mount the editor into
   * @param initialContent - Initial markdown content to display
   * @param options - Optional configuration
   */
  constructor(
    container: HTMLElement,
    initialContent: string = '',
    options: CodeMirrorEditorOptions = {}
  ) {
    super();
    this.container = container;
    this.options = options;
    this.changeEmitter = new EventEmitter<string>();

    // Create editor state with extensions
    const state = EditorState.create({
      doc: initialContent,
      extensions: this.createExtensions()
    });

    // Create editor view
    this.view = new EditorView({
      state,
      parent: container
    });

    // Setup dark mode observer if needed
    this.setupDarkModeObserver();
  }

  /**
   * Create CodeMirror extensions array
   */
  private createExtensions(): Extension[] {
    const extensions: Extension[] = [
      basicSetup,
      richEditor({ markdoc: {} }), // Use rich-markdoc for live preview
      EditorView.lineWrapping, // Enable text wrapping
      this.setupUpdateListener()
    ];

    // Add dark mode theme if specified
    if (this.options.darkMode) {
      this.container.setAttribute('data-color-mode', 'dark');
    }

    return extensions;
  }

  /**
   * Setup update listener to detect content changes
   */
  private setupUpdateListener(): Extension {
    return EditorView.updateListener.of((viewUpdate: ViewUpdate) => {
      if (viewUpdate.docChanged) {
        const content = viewUpdate.state.doc.toString();
        this.changeEmitter.emit(content);
      }
    });
  }

  /**
   * Setup dark mode observer to sync with system theme changes
   */
  private setupDarkModeObserver(): void {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      this.container.setAttribute('data-color-mode', isDark ? 'dark' : 'light');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Register cleanup
    this.registerDisposable(() => observer.disconnect());
  }

  /**
   * Helper to register disposables without exposing addDisposable
   */
  private registerDisposable(fn: () => void): void {
    // Store disposables internally for cleanup
    const disposables = (this as unknown as { _disposables?: (() => void)[] })._disposables;
    if (!disposables) {
      (this as unknown as { _disposables: (() => void)[] })._disposables = [];
    }
    (this as unknown as { _disposables: (() => void)[] })._disposables.push(fn);
  }

  /**
   * Get current editor content as string
   * @returns Current markdown content
   */
  getValue(): string {
    return this.view.state.doc.toString();
  }

  /**
   * Set editor content programmatically
   * @param content - New markdown content
   */
  setValue(content: string): void {
    const doc = this.view.state.doc;
    this.view.dispatch({
      changes: {
        from: 0,
        to: doc.length,
        insert: content
      }
    });
  }

  /**
   * Focus the editor
   */
  focus(): void {
    this.view.focus();
  }

  /**
   * Register a callback for content changes
   * @param callback - Function called with new content when editor changes
   * @returns Unsubscribe function to remove the listener
   */
  onChange(callback: (content: string) => void): () => void {
    return this.changeEmitter.on(callback);
  }

  /**
   * Clean up editor resources
   */
  dispose(): void {
    // Destroy the CodeMirror view
    this.view.destroy();

    // Clear event listeners
    this.changeEmitter.clear();

    // Call internal disposables cleanup
    const disposables = (this as unknown as { _disposables?: (() => void)[] })._disposables;
    if (disposables) {
      disposables.forEach(fn => fn());
      disposables.length = 0;
    }

    // Call parent dispose
    super.dispose();
  }
}
