import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeMirrorEditorView } from '@/components/floating-windows/CodeMirrorEditorView';

describe('CodeMirror Syntax Highlighting - Specific Token Test', () => {
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

  it('should apply ACTUAL tok- classes to TypeScript code', async () => {
    const tsCodeBlock = `\`\`\`typescript
class Widget {
  name: string;
}
\`\`\``;

    editor = new CodeMirrorEditorView(container, tsCodeBlock);

    // Wait for async syntax parsing
    await new Promise(resolve => setTimeout(resolve, 500));

    const editorHTML = container.innerHTML;

    console.log('=== Full HTML ===');
    console.log(editorHTML);
    console.log('===');

    // Check specifically for tok- classes (actual syntax highlighting)
    const hasTokKeyword = editorHTML.includes('tok-keyword');
    const hasTokTypeName = editorHTML.includes('tok-typeName');
    const hasTokVariableName = editorHTML.includes('tok-variableName');
    const hasTokClassName = editorHTML.includes('tok-className');

    console.log('tok-keyword:', hasTokKeyword);
    console.log('tok-typeName:', hasTokTypeName);
    console.log('tok-variableName:', hasTokVariableName);
    console.log('tok-className:', hasTokClassName);

    // At least ONE tok- class should be present for syntax highlighting to be working
    const hasAnyTokClass = hasTokKeyword || hasTokTypeName || hasTokVariableName || hasTokClassName;

    expect(hasAnyTokClass).toBe(true);
  });
});
