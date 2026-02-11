import '@/shell/UI/cytoscape-graph-ui/styles/floating-windows.css'; // Core floating window styles
import './codemirror-editor.css'; // CodeMirror-specific styles (selection, gutters, markdoc, diff)
import { vim } from '@replit/codemirror-vim';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, tooltips } from '@codemirror/view';
import { indentMore, indentLess } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { acceptCompletion } from '@codemirror/autocomplete';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { Disposable } from '@/shell/UI/views/Disposable';
import { EventEmitter } from '@/utils/EventEmitter';
import { mermaidRender } from '@/shell/UI/floating-windows/extensions/mermaidRender';
import { videoRender } from '@/shell/UI/floating-windows/extensions/videoRender';
import { externalVideoRender } from '@/shell/UI/floating-windows/extensions/externalVideoRender';
import { diffHighlight } from '@/shell/UI/floating-windows/extensions/diffHighlight';
import { wikilinkCompletion } from '@/shell/UI/floating-windows/extensions/wikilinkCompletion';
import { wikilinkTitleDisplay } from '@/shell/UI/floating-windows/extensions/wikilinkTitleDisplay';
import { createMarkdownExtensions } from './markdownExtensions';
import { createImagePasteHandler, createContextMenuHandler } from './editorDomHandlers';
import { createUpdateListener } from './updateListener';

/**
 * Detect if content contains YAML frontmatter delimiters (---).
 * Scans the first 1000 lines for 2+ lines that are exactly `---` (after trimming whitespace).
 * Permissive: doesn't require delimiters at line 0.
 */
export function hasFrontmatter(content: string): boolean {
  const lines: string[] = content.split(/\r?\n/);
  const limit: number = Math.min(lines.length, 1000);
  let yamlTagCount: number = 0;

  for (let i: number = 0; i < limit; i++) {
    if (lines[i].trim() === '---') {
      yamlTagCount++;
      if (yamlTagCount >= 2) return true;
    }
  }

  return false;
}

/**
 * Configuration options for CodeMirrorEditorView
 */
export interface CodeMirrorEditorOptions {
  previewMode?: 'edit' | 'live' | 'preview';
  darkMode?: boolean;
  autosaveDelay?: number;
  /** Language mode: 'markdown' (default) for rich markdown editing, 'json' for JSON syntax highlighting */
  language?: 'markdown' | 'json';
  /** Enable VIM keybindings */
  vimMode?: boolean;
  /** Node ID (file path) for image paste - required for saving pasted images as siblings */
  nodeId?: string;
}

/**
 * CodeMirrorEditorView wraps CodeMirror 6 to provide a clean API for markdown editing
 * in the Voicetree floating window system.
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
  private anyDocChangeEmitter: EventEmitter<void>; // Fires for ALL document changes (user + programmatic)
  private geometryChangeEmitter: EventEmitter<void>; // Fires when content geometry changes (after layout)
  private options: CodeMirrorEditorOptions;
  private updateListenerDispose: () => void;

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
    this.anyDocChangeEmitter = new EventEmitter<void>();
    this.geometryChangeEmitter = new EventEmitter<void>();

    // Create update listener (debounced change detection)
    const updateListener: { extension: Extension; dispose: () => void } = createUpdateListener({
      autosaveDelay: this.options.autosaveDelay ?? 300,
      changeEmitter: this.changeEmitter,
      anyDocChangeEmitter: this.anyDocChangeEmitter,
      geometryChangeEmitter: this.geometryChangeEmitter,
      container: this.container,
    });
    this.updateListenerDispose = updateListener.dispose;

    // Create editor state with extensions
    const state: EditorState = EditorState.create({
      doc: initialContent,
      extensions: this.createExtensions(updateListener.extension)
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
  private createExtensions(updateListenerExtension: Extension): Extension[] {
    // For JSON mode, use a simpler set of extensions
    if (this.options.language === 'json') {
      return this.createJsonExtensions(updateListenerExtension);
    }

    // Check if dark mode is active (either via option or from document class)
    const isDarkMode: boolean = this.options.darkMode ?? document.documentElement.classList.contains('dark');

    // Selection visibility fix is handled in floating-windows.css
    // (CM6's selection layer renders behind content - CSS ensures backgrounds are transparent)

    const extensions: Extension[] = [
      // VIM mode must come BEFORE basicSetup and other keymaps
      ...(this.options.vimMode ? [vim()] : []),
      basicSetup,
      // Tab: first try accepting autocomplete, then indent. Shift-Tab always indents less.
      // This fixes Tab not working to accept wikilink completions (indentWithTab was intercepting Tab first)
      keymap.of([
        { key: 'Tab', run: (view) => acceptCompletion(view) || indentMore(view) },
        { key: 'Shift-Tab', run: indentLess }
      ]),
      ...createMarkdownExtensions(), // Rich markdown editing, frontmatter folding, markdown keybindings
      mermaidRender(), // Render Mermaid diagrams in live preview
      videoRender(), // Render ![[video.mp4]] wikilinks as inline video players
      externalVideoRender(), // Render YouTube/Vimeo/Loom URLs as inline video embeds
      diffHighlight(), // Highlight diff lines (+/-) in code blocks with green/red backgrounds
      wikilinkCompletion(), // Autocomplete for [[wikilinks]] - shows nodes ordered by recency
      wikilinkTitleDisplay(), // Display node titles instead of IDs in [[wikilinks]] - uses Mark decorations + CSS
      tooltips({ parent: document.body }), // Render tooltips (including autocomplete) in body to avoid overflow clipping
      EditorView.lineWrapping, // Enable text wrapping
      updateListenerExtension,
      createImagePasteHandler(this.options.nodeId), // Handle pasting images from clipboard
      createContextMenuHandler(this.options.language) // Right-click menu with "Add Link" option
    ];

    // Add dark mode theme if active
    if (isDarkMode) {
      extensions.push(oneDark);
      this.container.setAttribute('data-color-mode', 'dark');
    }

    return extensions;
  }

  /**
   * Create simplified extensions for JSON editing mode
   */
  private createJsonExtensions(updateListenerExtension: Extension): Extension[] {
    // Check if dark mode is active (either via option or from document class)
    const isDarkMode: boolean = this.options.darkMode ?? document.documentElement.classList.contains('dark');

    const extensions: Extension[] = [
      basicSetup,
      json(), // JSON language support with syntax highlighting
      syntaxHighlighting(defaultHighlightStyle), // Code coloring
      EditorView.lineWrapping, // Enable text wrapping
      updateListenerExtension
    ];

    // Add dark mode theme if active
    if (isDarkMode) {
      extensions.push(oneDark);
      this.container.setAttribute('data-color-mode', 'dark');
    }

    return extensions;
  }

  /**
   * Setup dark mode observer to sync with system theme changes
   */
  private setupDarkModeObserver(): void {
    const observer: MutationObserver = new MutationObserver(() => {
      const isDark: boolean = document.documentElement.classList.contains('dark');
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
    const disposables: (() => void)[] | undefined = (this as unknown as { _disposables?: (() => void)[] })._disposables;
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
   * @param content - New content
   */
  setValue(content: string): void {
    // Preserve cursor position before replacing content
    const cursorPos: number = this.view.state.selection.main.head;
    // Clamp to new content length (content may be shorter)
    const newCursorPos: number = Math.min(cursorPos, content.length);

    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: content },
      selection: { anchor: newCursorPos }
    });
  }

  /**
   * Focus the editor
   */
  focus(): void {
    this.view.focus();
  }

  /**
   * Set cursor to the end of the document and focus
   * Used when opening editor for newly created nodes
   */
  focusAtEnd(): void {
    const docLength: number = this.view.state.doc.length;
    this.view.dispatch({
      selection: { anchor: docLength }
    });
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
   * Get the content height of the editor in pixels
   * This is the height of the document content, not the visible viewport
   * Uses DOM measurement (.cm-content scrollHeight) for accuracy, as CodeMirror's
   * view.contentHeight may not reflect actual rendered content height.
   * @returns Content height in pixels
   */
  getContentHeight(): number {
    const cmContent: HTMLElement | null = this.container.querySelector('.cm-content');
    if (cmContent) {
      return cmContent.scrollHeight;
    }
    // Fallback to CodeMirror's API
    return this.view.contentHeight;
  }

  /**
   * Register a callback for ANY document changes (user + programmatic)
   * Unlike onChange, this fires for setValue() calls too.
   * @param callback - Function called when document changes
   * @returns Unsubscribe function to remove the listener
   */
  onAnyDocChange(callback: () => void): () => void {
    return this.anyDocChangeEmitter.on(callback);
  }

  /**
   * Register a callback for geometry changes (content height/width changes)
   * Fires AFTER CodeMirror has recalculated layout, so contentHeight is accurate.
   * Used for auto-height resizing.
   * @param callback - Function called when geometry changes
   * @returns Unsubscribe function to remove the listener
   */
  onGeometryChange(callback: () => void): () => void {
    return this.geometryChangeEmitter.on(callback);
  }

  /**
   * Clean up editor resources
   */
  dispose(): void {
    // Clear any pending debounce timeout
    this.updateListenerDispose();

    // Destroy the CodeMirror view
    this.view.destroy();

    // Clear event listeners
    this.changeEmitter.clear();
    this.anyDocChangeEmitter.clear();
    this.geometryChangeEmitter.clear();

    // Call internal disposables cleanup
    const disposables: (() => void)[] | undefined = (this as unknown as { _disposables?: (() => void)[] })._disposables;
    if (disposables) {
      disposables.forEach(fn => fn());
      disposables.length = 0;
    }

    // Call parent dispose
    super.dispose();
  }
}
