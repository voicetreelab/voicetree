import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

describe('Minimal CodeMirror Syntax Highlighting Test', () => {
  let container: HTMLElement;
  let view: EditorView | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (view) {
      view.destroy();
      view = null;
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it('should apply syntax highlighting with basic setup', async () => {
    const content = `\`\`\`typescript
class Widget {
  name: string;
}
\`\`\``;

    const state = EditorState.create({
      doc: content,
      extensions: [
        markdown({
          codeLanguages: [
            LanguageDescription.of({
              name: 'typescript',
              alias: ['ts'],
              support: javascript({ typescript: true })
            })
          ]
        }),
        syntaxHighlighting(oneDarkHighlightStyle)
      ]
    });

    view = new EditorView({
      state,
      parent: container
    });

    // Wait for syntax parsing
    await new Promise(resolve => setTimeout(resolve, 500));

    const html = container.innerHTML;

    console.log('=== MINIMAL TEST HTML ===');
    console.log(html.substring(0, 2000));
    console.log('===');

    // Check for tok- classes
    const hasTokClasses = html.includes('tok-');
    console.log('Has tok- classes:', hasTokClasses);

    expect(hasTokClasses).toBe(true);
  });
});
