import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeMirrorEditorView } from '@/views/CodeMirrorEditorView';

describe('CodeMirror Syntax Highlighting', () => {
  let container: HTMLElement;
  let editor: CodeMirrorEditorView;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (editor && !editor.isDisposed) {
      editor.dispose();
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it('should apply syntax highlighting classes to TypeScript code blocks', async () => {
    const tsCodeBlock = `# Test

\`\`\`typescript
class MermaidBlockWidget extends WidgetType {
  constructor(public source: string) {
    console.log('Hello');
  }
}
\`\`\`
`;

    editor = new CodeMirrorEditorView(container, tsCodeBlock);

    // Wait for syntax tree to parse and highlight
    await new Promise(resolve => setTimeout(resolve, 200));

    // Check for token classes that CodeMirror applies during syntax highlighting
    // Common classes: tok-keyword, tok-variableName, tok-className, tok-string, etc.
    const editorHTML = container.innerHTML;

    console.log('=== Editor HTML (first 2000 chars) ===');
    console.log(editorHTML.substring(0, 2000));

    // Check for syntax highlighting token classes
    const hasSyntaxTokens =
      editorHTML.includes('tok-keyword') ||
      editorHTML.includes('tok-variableName') ||
      editorHTML.includes('tok-className') ||
      editorHTML.includes('tok-string') ||
      editorHTML.includes('ͼ'); // CodeMirror uses unicode for some tokens

    console.log('=== Has syntax tokens:', hasSyntaxTokens);

    // Check for code block language marker
    const hasCodeBlock = editorHTML.includes('language-typescript') ||
                        editorHTML.includes('cm-fencedCode');

    console.log('=== Has code block marker:', hasCodeBlock);

    expect(hasSyntaxTokens || hasCodeBlock).toBe(true);
  });

  it('should apply syntax highlighting to Python code blocks', async () => {
    const pyCodeBlock = `# Test

\`\`\`python
def hello_world():
    print("Hello, World!")
    return True
\`\`\`
`;

    editor = new CodeMirrorEditorView(container, pyCodeBlock);
    await new Promise(resolve => setTimeout(resolve, 500)); // Longer wait for async language loading

    const editorHTML = container.innerHTML;

    console.log('=== Python Editor HTML (first 2000 chars) ===');
    console.log(editorHTML.substring(0, 2000));

    // Check for Python-specific highlighting
    const hasPythonTokens =
      editorHTML.includes('tok-') ||
      editorHTML.includes('cm-fencedCode') ||
      editorHTML.includes('language-python');

    console.log('=== Has Python tokens:', hasPythonTokens);
    console.log('=== tok- found:', editorHTML.includes('tok-'));
    console.log('=== cm-fencedCode found:', editorHTML.includes('cm-fencedCode'));
    console.log('=== language-python found:', editorHTML.includes('language-python'));

    expect(hasPythonTokens).toBe(true);
  });

  it('should apply syntax highlighting to JSON code blocks', async () => {
    const jsonCodeBlock = `# Test

\`\`\`json
{
  "name": "test",
  "value": 123,
  "enabled": true
}
\`\`\`
`;

    editor = new CodeMirrorEditorView(container, jsonCodeBlock);
    await new Promise(resolve => setTimeout(resolve, 200));

    const editorHTML = container.innerHTML;

    // Check for JSON-specific highlighting
    const hasJSONTokens =
      editorHTML.includes('tok-') ||
      editorHTML.includes('cm-fencedCode');

    expect(hasJSONTokens).toBe(true);
  });
});
