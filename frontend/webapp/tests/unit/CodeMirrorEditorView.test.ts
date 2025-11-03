import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodeMirrorEditorView } from '@/components/floating-windows/CodeMirrorEditorView';

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

  it('should handle complete markdown editor lifecycle', async () => {
    const initialContent = `---
node_id: 1
title: Test Note
---

# Hello World

This is a test.`;

    // Create editor
    editor = new CodeMirrorEditorView(container, initialContent);

    // Test getValue returns initial content
    expect(editor.getValue()).toBe(initialContent);

    // Test setValue updates content
    const newContent = '# Updated Content\n\nNew text here.';
    editor.setValue(newContent);
    expect(editor.getValue()).toBe(newContent);

    // Test onChange callback registration and event emission (with debounce)
    let changedContent = '';
    let changeCallCount = 0;
    const unsubscribe = editor.onChange((content) => {
      changedContent = content;
      changeCallCount++;
    });

    // Trigger a content change by setting value again
    const thirdContent = '# Third Version\n\nMore text.';
    editor.setValue(thirdContent);

    // onChange should NOT have fired yet (debounced)
    expect(changeCallCount).toBe(0);

    // Wait for debounce delay (default 300ms)
    await new Promise(resolve => setTimeout(resolve, 350));

    // onChange should have fired after debounce
    expect(changeCallCount).toBe(1);
    expect(changedContent).toBe(thirdContent);

    // Test unsubscribe
    unsubscribe();
    editor.setValue('# Fourth Version');
    await new Promise(resolve => setTimeout(resolve, 350));
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

  it('should hide markdown formatting marks (###) when not editing that line', async () => {
    // Create editor with a heading
    const markdownContent = '### My Heading\n\nSome content';
    editor = new CodeMirrorEditorView(container, markdownContent);

    // IMPORTANT: Move cursor to a different line (not the heading line)
    // The RichEditPlugin only hides ### marks when cursor is NOT on that line
    const view = (editor as any).view;
    view.dispatch({
      selection: { anchor: 20 } // Position in "Some content" line
    });

    // Wait for decorations to apply
    await new Promise(resolve => setTimeout(resolve, 200));

    // Debug: Inspect the syntax tree AND visible ranges
    const { syntaxTree } = await import('@codemirror/language');
    const tree = syntaxTree(view.state);

    const nodeNames: string[] = [];
    tree.iterate({
      enter(node) {
        nodeNames.push(node.name);
      }
    });

    // Check visible ranges
    const visibleRanges = view.visibleRanges;
    const visibleInfo = visibleRanges.length > 0
      ? `${visibleRanges.length} ranges: ${visibleRanges.map((r: any) => `${r.from}-${r.to}`).join(', ')}`
      : 'EMPTY - NO VISIBLE RANGES!';

    // Write nodes to file
    const fs = await import('fs');
    const path = await import('path');
    const nodesPath = path.join(process.cwd(), 'test-syntax-nodes.txt');
    fs.writeFileSync(nodesPath, `SYNTAX TREE NODES:\n${nodeNames.join(', ')}\n\nHas HeaderMark: ${nodeNames.includes('HeaderMark')}\n\nVisible Ranges: ${visibleInfo}`);

    // Check if HeaderMark exists
    const hasHeaderMark = nodeNames.includes('HeaderMark');

    // Check that cm-markdoc-hidden class exists
    const hiddenElement = container.querySelector('.cm-markdoc-hidden');

    if (!hiddenElement && hasHeaderMark) {
      throw new Error(`HeaderMark node exists but cm-markdoc-hidden class not applied! Nodes: ${nodesPath}`);
    }

    if (!hiddenElement && !hasHeaderMark) {
      throw new Error(`HeaderMark node NOT in tree! Check ${nodesPath} for actual nodes`);
    }

    // For now, just check if we have the node in the tree
    // We can fix the decoration application once we know the tree structure
    expect(nodeNames.length).toBeGreaterThan(0);
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

  it('should debounce onChange events to prevent excessive saves', async () => {
    // Create editor with custom short debounce delay for faster testing
    editor = new CodeMirrorEditorView(container, '# Initial', { autosaveDelay: 100 });

    let changeCallCount = 0;
    let lastContent = '';
    editor.onChange((content) => {
      changeCallCount++;
      lastContent = content;
    });

    // Make multiple rapid changes
    editor.setValue('# Change 1');
    await new Promise(resolve => setTimeout(resolve, 50));
    editor.setValue('# Change 2');
    await new Promise(resolve => setTimeout(resolve, 50));
    editor.setValue('# Change 3');

    // At this point, no onChange should have fired yet
    expect(changeCallCount).toBe(0);

    // Wait for debounce delay
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should only have called onChange once with the final content
    expect(changeCallCount).toBe(1);
    expect(lastContent).toBe('# Change 3');
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

  it('should support fullscreen mode for markdown editor', async () => {
    // Mock fullscreen API (not always available in test environment)
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);

    // Override fullscreen API on container
    container.requestFullscreen = requestFullscreenMock;
    Object.defineProperty(document, 'exitFullscreen', {
      value: exitFullscreenMock,
      writable: true,
      configurable: true
    });

    // Create editor
    editor = new CodeMirrorEditorView(container, '# Test Content');

    // Initially not fullscreen
    expect(editor.isFullscreen()).toBe(false);

    // Enter fullscreen
    await editor.enterFullscreen();
    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);

    // Mock fullscreen state change
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true
    });

    // Now should be fullscreen
    expect(editor.isFullscreen()).toBe(true);

    // Exit fullscreen
    await editor.exitFullscreen();
    expect(exitFullscreenMock).toHaveBeenCalledTimes(1);

    // Mock fullscreen state change
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true
    });

    // Should not be fullscreen
    expect(editor.isFullscreen()).toBe(false);

    // Test toggle from non-fullscreen
    await editor.toggleFullscreen();
    expect(requestFullscreenMock).toHaveBeenCalledTimes(2);

    // Mock fullscreen state change
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true
    });

    // Test toggle from fullscreen
    await editor.toggleFullscreen();
    expect(exitFullscreenMock).toHaveBeenCalledTimes(2);

    // Cleanup should exit fullscreen if active
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true
    });
    editor.dispose();

    // Should have called exitFullscreen during dispose
    expect(exitFullscreenMock).toHaveBeenCalledTimes(3);
  });
});
