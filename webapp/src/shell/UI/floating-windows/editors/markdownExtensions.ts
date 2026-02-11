import type { Extension } from '@codemirror/state';
import type { Line } from '@codemirror/state';
import { ViewPlugin, keymap } from '@codemirror/view';
import { syntaxHighlighting, foldService } from '@codemirror/language';
import type { LanguageSupport } from '@codemirror/language';
import type { Tree } from '@lezer/common';
import { syntaxTree } from '@codemirror/language';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { yamlFrontmatter } from '@codemirror/lang-yaml';
import { languages } from '@codemirror/language-data';
import tagParser from 'codemirror-rich-markdoc/src/tagParser';
import RichEditPlugin from 'codemirror-rich-markdoc/src/richEdit';
import renderBlock from 'codemirror-rich-markdoc/src/renderBlock';
import { combinedHighlightStyle } from './highlightStyle';

/**
 * Create markdown-specific CodeMirror extensions:
 * - Rich Markdoc editing plugin (inline rendering of Markdoc tags)
 * - YAML frontmatter fold service
 * - Markdown keybindings (Enter continues lists, Backspace removes list markers)
 */
export function createMarkdownExtensions(): Extension[] {
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

  return [
    keymap.of(markdownKeymap), // Enter continues lists, Backspace removes list markers
    richMarkdocPlugin, // Rich markdown editing (provides markdown, decorations, and syntax highlighting inside provide())
    frontmatterFoldService, // Custom fold service for frontmatter (foldGutter is already in basicSetup)
  ];
}
