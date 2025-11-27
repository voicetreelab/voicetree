import '@/shell/UI/cytoscape-graph-ui/styles/floating-windows.css'; // VERY IMPORTANT
import { EditorState, type Extension } from '@codemirror/state';
import type { Text, Line } from '@codemirror/state';
import { EditorView, ViewUpdate, ViewPlugin } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { foldGutter, syntaxHighlighting, foldEffect, foldable, foldService, LanguageDescription, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import type { LanguageSupport } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Tree } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { java } from '@codemirror/lang-java';
import tagParser from 'codemirror-rich-markdoc/src/tagParser';
import richMarkdocHighlightStyle from 'codemirror-rich-markdoc/src/highlightStyle';

// Custom h1 override - applied on top of rich-markdoc defaults
const customH1Style: HighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontWeight: 'bold', fontFamily: 'sans-serif', fontSize: '18px', textDecoration: 'underline' },
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

    // Auto-fold frontmatter on initialization
    this.autoFoldFrontmatter();

    // Setup dark mode observer if needed
    this.setupDarkModeObserver();
  }

  /**
   * Create CodeMirror extensions array
   */
  private createExtensions(): Extension[] {
    // Manually compose rich-markdoc extensions with yamlFrontmatter support
    // We can't use the richEditor() function because it always calls markdown() internally
    // Instead, we need to build the extensions ourselves:

    // 1. Create markdown config with tagParser extension (for Markdoc {% %} tags)
    // and codeLanguages for syntax highlighting in code blocks
    const markdownConfig: Parameters<typeof markdown>[0] = {
      extensions: [tagParser],
      codeLanguages: [
        LanguageDescription.of({ name: 'javascript', alias: ['js'], support: javascript() }),
        LanguageDescription.of({ name: 'typescript', alias: ['ts'], support: javascript({ typescript: true }) }),
        LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
        LanguageDescription.of({ name: 'json', alias: [], support: json() }),
        LanguageDescription.of({ name: 'java', alias: [], support: java() })
      ]
    };

    // 2. Wrap markdown with yamlFrontmatter support
    const markdownWithFrontmatter: LanguageSupport = yamlFrontmatter({
      content: markdown(markdownConfig)
    });

    // 3. Build the rich-markdoc plugin manually
    // IMPORTANT: The markdown language must be provided BY the plugin, not as a separate extension
    const richMarkdocPlugin: ViewPlugin<RichEditPlugin, undefined> = ViewPlugin.fromClass(RichEditPlugin, {
      decorations: v => v.decorations,
      provide: () => [
        markdownWithFrontmatter, // Provide markdown with frontmatter support
        renderBlock({}), // Markdoc config
        syntaxHighlighting(richMarkdocHighlightStyle), // Base rich-markdoc styles for h2, h3, etc.
        syntaxHighlighting(customH1Style) // Override h1 to be smaller
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

    const extensions: Extension[] = [
      basicSetup,
      richMarkdocPlugin, // Rich markdown editing (provides markdown, decorations, and syntax highlighting)
      syntaxHighlighting(defaultHighlightStyle), // Code block syntax highlighting
      mermaidRender(), // Render Mermaid diagrams in live preview
      frontmatterFoldService, // Custom fold service for frontmatter
      foldGutter(), // Add fold gutter for collapsing sections
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
   * Debounces emissions based on autosaveDelay option (default: 300ms)
   */
  private setupUpdateListener(): Extension {
    return EditorView.updateListener.of((viewUpdate: ViewUpdate) => {
      if (viewUpdate.docChanged) {
        const content: string = viewUpdate.state.doc.toString();
        const delay: number = this.options.autosaveDelay ?? 300;

        // Clear existing timeout
        if (this.debounceTimeout) {
          clearTimeout(this.debounceTimeout);
        }

        // Set new timeout to emit after delay
        this.debounceTimeout = setTimeout(() => {
          this.changeEmitter.emit(content);
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
   * @param content - New markdown content
   */
  setValue(content: string): void {
    // Check if current content has frontmatter
    const oldContent: string = this.view.state.doc.toString();
    const oldHasFrontmatter: boolean = this.hasFrontmatter(oldContent);
    const newHasFrontmatter: boolean = this.hasFrontmatter(content);

    const doc: Text = this.view.state.doc;
    this.view.dispatch({
      changes: {
        from: 0,
        to: doc.length,
        insert: content
      }
    });

    // Only auto-fold if this is NEW frontmatter (wasn't there before)
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
