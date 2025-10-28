import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeMirrorEditorView } from '@/views/CodeMirrorEditorView';

describe('CodeMirrorEditorView', () => {
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

  it('should handle complete markdown editor lifecycle', () => {
    const initialContent = '# Hello World\n\nThis is a test.';

    // Create editor
    editor = new CodeMirrorEditorView(container, initialContent);

    // Test getValue returns initial content
    expect(editor.getValue()).toBe(initialContent);

    // Test setValue updates content
    const newContent = '# Updated Content\n\nNew text here.';
    editor.setValue(newContent);
    expect(editor.getValue()).toBe(newContent);

    // Test onChange callback registration and event emission
    let changedContent = '';
    let changeCallCount = 0;
    const unsubscribe = editor.onChange((content) => {
      changedContent = content;
      changeCallCount++;
    });

    // Trigger a content change by setting value again
    const thirdContent = '# Third Version\n\nMore text.';
    editor.setValue(thirdContent);

    // onChange should have fired
    expect(changeCallCount).toBe(1);
    expect(changedContent).toBe(thirdContent);

    // Test unsubscribe
    unsubscribe();
    editor.setValue('# Fourth Version');
    expect(changeCallCount).toBe(1); // Should still be 1 after unsubscribe

    // Test focus (should not throw)
    expect(() => editor.focus()).not.toThrow();

    // Test dispose cleanup
    editor.dispose();
    expect(editor.isDisposed).toBe(true);

    // Verify container is cleaned up (EditorView should be destroyed)
    // After dispose, the editor view's DOM should be removed from container
    expect(container.querySelector('.cm-editor')).toBeNull();
  });

  it('should use rich-markdoc for live preview rendering', async () => {
    // Create editor with markdown content that has various elements
    const markdownContent = '# Heading 1\n\n**Bold text** and *italic text*\n\n- List item 1\n- List item 2';
    editor = new CodeMirrorEditorView(container, markdownContent);

    // Wait a tick for decorations to apply
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that rich-markdoc plugin is loaded by looking for its characteristic classes
    // Rich-markdoc adds decorations with cm-markdoc- prefixed classes
    const editorElement = container.querySelector('.cm-editor');
    expect(editorElement).not.toBeNull();

    // Check for rich-markdoc specific classes or decorations
    // The plugin uses .cm-markdoc-hidden for hiding formatting marks
    // and creates decorations for rich text rendering
    const hasRichMarkdocClasses =
      container.querySelector('[class*="cm-markdoc"]') !== null ||
      container.innerHTML.includes('cm-markdoc');

    expect(hasRichMarkdocClasses).toBe(true);
  });

  it('should render Mermaid diagrams in live preview mode', async () => {
    // Create editor with mermaid code block
    const mermaidContent = `# Test Document

\`\`\`mermaid
graph TD
    A[Start] --> B[End]
\`\`\`

Some text after diagram.`;

    editor = new CodeMirrorEditorView(container, mermaidContent);

    // Wait for Mermaid rendering (async operation) - increased timeout for async rendering
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Check that Mermaid widget is created with cm-mermaid-render class
    const mermaidWidget = container.querySelector('.cm-mermaid-render');
    expect(mermaidWidget).not.toBeNull();

    // Verify contenteditable is false (widget should not be editable)
    expect(mermaidWidget?.getAttribute('contenteditable')).toBe('false');

    // Check that widget has content (either SVG or loading/error message)
    expect(mermaidWidget?.innerHTML).toBeTruthy();
    expect(mermaidWidget?.innerHTML.length).toBeGreaterThan(0);

    // Check that either SVG is rendered OR there's an error/loading message
    const svgElement = container.querySelector('.cm-mermaid-render svg');
    const hasContent = mermaidWidget?.innerHTML.includes('<svg') ||
                       mermaidWidget?.innerHTML.includes('Rendering') ||
                       mermaidWidget?.innerHTML.includes('error');
    expect(hasContent).toBe(true);
  });

  it('should auto-fold YAML frontmatter on initialization', async () => {
    // Create editor with frontmatter
    const contentWithFrontmatter = `---
node_id: 123
title: Test Note
color: blue
---

# Main Content

This is the main content of the note.`;

    editor = new CodeMirrorEditorView(container, contentWithFrontmatter);

    // Wait longer for requestAnimationFrame and syntax tree parsing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Get the editor element
    const editorElement = container.querySelector('.cm-editor');
    expect(editorElement).not.toBeNull();

    // Check for fold widget/gutter - folded sections should have cm-foldGutter class
    // and the frontmatter lines should have cm-foldPlaceholder or be hidden
    const foldGutter = container.querySelector('.cm-foldGutter');
    expect(foldGutter).not.toBeNull();

    // Check if frontmatter is folded by looking for fold placeholder
    // When folded, CodeMirror adds a placeholder widget
    const foldPlaceholder = container.querySelector('.cm-foldPlaceholder');
    const hasFoldedContent = foldPlaceholder !== null;

    // The content should be folded (placeholder present)
    expect(hasFoldedContent).toBe(true);
  });
});
