import '@/shell/UI/cytoscape-graph-ui/styles/floating-windows.css'; // VERY IMPORTANT
import { EditorState, type Extension } from '@codemirror/state';
import type { Text, Line } from '@codemirror/state';
import { EditorView, ViewUpdate, ViewPlugin } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { foldGutter, syntaxHighlighting, foldEffect, foldable, foldService, HighlightStyle, defaultHighlightStyle } from '@codemirror/language';
import type { LanguageSupport } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Tree } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import tagParser from 'codemirror-rich-markdoc/src/tagParser';

// Combined highlight style: code syntax colors from defaultHighlightStyle + custom heading styles (no underlines)
// We can't use defaultHighlightStyle directly because it has heading underlines we don't want
const combinedHighlightStyle: HighlightStyle = HighlightStyle.define([
  // Heading styles (no underlines, proper size hierarchy)
  { tag: t.heading, fontWeight: 'bold', fontFamily: 'sans-serif', textDecoration: 'none' },
  { tag: t.heading1, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '24px', textDecoration: 'none' },
  { tag: t.heading2, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '21px', textDecoration: 'none' },
  { tag: t.heading3, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '18px', textDecoration: 'none' },
  { tag: t.heading4, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '16px', textDecoration: 'none' },
  // Code syntax highlighting (from defaultHighlightStyle)
  { tag: t.meta, color: '#404740' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.keyword, color: '#708' },
  { tag: [t.atom, t.bool, t.url, t.contentSeparator, t.labelName], color: '#219' },
  { tag: [t.literal, t.inserted], color: '#164' },
  { tag: [t.string, t.deleted], color: '#a11' },
  { tag: [t.regexp, t.escape, t.special(t.string)], color: '#e40' },
  { tag: t.definition(t.variableName), color: '#00f' },
  { tag: t.local(t.variableName), color: '#30a' },
  { tag: [t.typeName, t.namespace], color: '#085' },
  { tag: t.className, color: '#167' },
  { tag: [t.special(t.variableName), t.macroName], color: '#256' },
  { tag: t.definition(t.propertyName), color: '#00c' },
  { tag: t.comment, color: '#940' },
  { tag: t.invalid, color: '#f00' },
]);
import RichEditPlugin from 'codemirror-rich-markdoc/src/richEdit';
import renderBlock from 'codemirror-rich-markdoc/src/renderBlock';
import { Disposable } from '@/shell/UI/views/Disposable';
import { EventEmitter } from '@/utils/EventEmitter';
import { mermaidRender } from '@/shell/UI/floating-windows/extensions/mermaidRender';
import { FloatingWindowFullscreen } from '@/shell/UI/floating-windows/FloatingWindowFullscreen';

/**
 * Configuration options for CodeMirrorEditorView
 */
export interface CodeMirrorEditorOptions {
  previewMode?: 'edit' | 'live' | 'preview';
  darkMode?: boolean;
  autosaveDelay?: number;
  /** Language mode: 'markdown' (default) for rich markdown editing, 'json' for JSON syntax highlighting */
  language?: 'markdown' | 'json';
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
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private fullscreen: FloatingWindowFullscreen;

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

    // Setup fullscreen (no callback needed - CodeMirror auto-resizes)
    this.fullscreen = new FloatingWindowFullscreen(container);

    // Create editor state with extensions
    const state: EditorState = EditorState.create({
      doc: initialContent,
      extensions: this.createExtensions()
    });

    // Create editor view
    this.view = new EditorView({
      state,
      parent: container
    });

    // Auto-fold frontmatter on initialization (only for markdown mode)
    if (this.options.language !== 'json') {
      this.autoFoldFrontmatter();
    }

    // Setup dark mode observer if needed
    this.setupDarkModeObserver();
  }

  /**
   * Create CodeMirror extensions array
   */
  private createExtensions(): Extension[] {
    // For JSON mode, use a simpler set of extensions
    if (this.options.language === 'json') {
      return this.createJsonExtensions();
    }

    // Build markdown config with tagParser extension (for Markdoc {% %} tags)
    // and codeLanguages for syntax highlighting in code blocks
    const markdownConfig: Parameters<typeof markdown>[0] = {
      extensions: [tagParser],
      codeLanguages: languages
    };

    // Wrap markdown with yamlFrontmatter support
    const markdownWithFrontmatter: LanguageSupport = yamlFrontmatter({
      content: markdown(markdownConfig)
    });

    // Manually compose rich-markdoc plugin with syntaxHighlighting INSIDE provide()
    // This is required for code block syntax coloring to work correctly
    // (richEditor() includes syntaxHighlighting in provide, we do the same)
    const richMarkdocPlugin: Extension = ViewPlugin.fromClass(RichEditPlugin, {
      decorations: v => v.decorations,
      provide: () => [
        markdownWithFrontmatter,
        renderBlock({}),
        syntaxHighlighting(combinedHighlightStyle),  // Combined: heading styles (no underlines) + code syntax colors
      ],
      eventHandlers: {
        mousedown({ target }, view) {
          if (target instanceof Element && target.matches('.cm-markdoc-renderBlock *'))
            view.dispatch({ selection: { anchor: view.posAtDOM(target) } });
        }
      }
    });

    // Add custom fold service for YAML frontmatter
    const frontmatterFoldService: Extension = foldService.of((state, from, to) => {
      const tree: Tree = syntaxTree(state);
      let foldRange: { from: number; to: number } | null = null;

      // Check if we're at the start of a Frontmatter node
      tree.iterate({
        from,
        to: Math.min(to, from + 1000),
        enter: (node) => {
          if (node.name === 'Frontmatter' && node.from === from) {
            // Fold from the opening --- to the closing ---
            // We want to keep the first line visible (opening ---) and fold the rest
            const firstLine: Line = state.doc.lineAt(node.from);
            foldRange = { from: firstLine.to, to: node.to-1 };
            return false; // Stop iterating
          }
        }
      });

      return foldRange;
    });

    // Check if dark mode is active (either via option or from document class)
    const isDarkMode: boolean = this.options.darkMode ?? document.documentElement.classList.contains('dark');

    const extensions: Extension[] = [
      basicSetup,
      richMarkdocPlugin, // Rich markdown editing (provides markdown, decorations, and syntax highlighting inside provide())
      mermaidRender(), // Render Mermaid diagrams in live preview
      frontmatterFoldService, // Custom fold service for frontmatter
      foldGutter(), // Add fold gutter for collapsing sections
      EditorView.lineWrapping, // Enable text wrapping
      this.setupUpdateListener()
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
  private createJsonExtensions(): Extension[] {
    // Check if dark mode is active (either via option or from document class)
    const isDarkMode: boolean = this.options.darkMode ?? document.documentElement.classList.contains('dark');

    const extensions: Extension[] = [
      basicSetup,
      json(), // JSON language support with syntax highlighting
      syntaxHighlighting(defaultHighlightStyle), // Code coloring
      EditorView.lineWrapping, // Enable text wrapping
      this.setupUpdateListener()
    ];

    // Add dark mode theme if active
    if (isDarkMode) {
      extensions.push(oneDark);
      this.container.setAttribute('data-color-mode', 'dark');
    }

    return extensions;
  }

  /**
   * Setup update listener to detect content changes
   * Debounces emissions based on autosaveDelay option (default: 300ms)
   *
   * Only emits for user input (typing, paste, etc.) - NOT for programmatic setValue() calls.
   * This prevents feedback loops without needing an external awaiting store.
   */
  private setupUpdateListener(): Extension {
    return EditorView.updateListener.of((viewUpdate: ViewUpdate) => {
      if (viewUpdate.docChanged) {
        // Only emit for user-initiated changes - not programmatic setValue() calls
        // User events: input (typing/paste), delete (backspace/del), undo, redo
        const isUserChange: boolean = viewUpdate.transactions.some(
          tr => tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("undo") || tr.isUserEvent("redo")
        );

        if (!isUserChange) {
          return; // Skip programmatic changes
        }

        const delay: number = this.options.autosaveDelay ?? 300;

        // Clear existing timeout
        if (this.debounceTimeout) {
          clearTimeout(this.debounceTimeout);
        }

        // Set new timeout to emit after delay
        // Read current content at fire time, not captured content at debounce start
        // This ensures external changes (e.g., appended links) are included in the save
        this.debounceTimeout = setTimeout(() => {
          this.changeEmitter.emit(this.view.state.doc.toString());
          this.debounceTimeout = null;
        }, delay);
      }
    });
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
   * Auto-fold YAML frontmatter block if present at the start of document
   */
  private autoFoldFrontmatter(): void {
    // Use requestAnimationFrame to ensure the syntax tree is fully parsed
    requestAnimationFrame(() => {
      // Query the foldService at position 0 to see if there's a foldable range
      // Our custom foldService will return the frontmatter fold range if present
      const foldRange: { from: number; to: number; } | null = foldable(this.view.state, 0, this.view.state.doc.length);

      if (foldRange) {
        // Dispatch the fold effect to collapse the frontmatter
        this.view.dispatch({
          effects: foldEffect.of(foldRange)
        });
      }
    });
  }

  /**
   * Check if content contains YAML frontmatter
   * @param content - The content to check
   * @returns true if content has frontmatter (starts with --- and has closing ---)
   */
  private hasFrontmatter(content: string): boolean {
    const lines: string[] = content.split('\n');
    let yamlTagCount: number = 0;
    for (let i: number = 0; i < Math.min(lines.length, 1000); i++) {
      if (lines[i].trim() === '---') {
        yamlTagCount +=1;
      }
    }

    return yamlTagCount >= 2;
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
    // Check if current content has frontmatter (only for markdown mode)
    const oldHasFrontmatter: boolean = this.options.language !== 'json' && this.hasFrontmatter(this.view.state.doc.toString());
    const newHasFrontmatter: boolean = this.options.language !== 'json' && this.hasFrontmatter(content);

    const doc: Text = this.view.state.doc;
    this.view.dispatch({
      changes: {
        from: 0,
        to: doc.length,
        insert: content
      }
    });

    // Only auto-fold if this is NEW frontmatter (wasn't there before) - markdown mode only
    if (!oldHasFrontmatter && newHasFrontmatter) {
      this.autoFoldFrontmatter();
    }
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
   * Enter fullscreen mode
   */
  async enterFullscreen(): Promise<void> {
    await this.fullscreen.enter();
  }

  /**
   * Exit fullscreen mode
   */
  async exitFullscreen(): Promise<void> {
    await this.fullscreen.exit();
  }

  /**
   * Toggle fullscreen mode
   */
  async toggleFullscreen(): Promise<void> {
    await this.fullscreen.toggle();
  }

  /**
   * Check if editor is in fullscreen mode
   */
  isFullscreen(): boolean {
    return this.fullscreen.isFullscreen();
  }

  /**
   * Clean up editor resources
   */
  dispose(): void {
    // Clear any pending debounce timeout
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    // Cleanup fullscreen
    this.fullscreen.dispose();

    // Destroy the CodeMirror view
    this.view.destroy();

    // Clear event listeners
    this.changeEmitter.clear();

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
