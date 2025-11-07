import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CodeMirrorEditorView } from '@/components/floating-windows/CodeMirrorEditorView';

describe('Frontmatter Parsing', () => {
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

  it('should display both opening and closing --- delimiters', async () => {
    const frontmatterContent = `---
node_id: 123
title: Test Node
color: blue
---

# Main content here`;

    editor = new CodeMirrorEditorView(container, frontmatterContent);

    // Wait for CodeMirror to render
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get the text content from the editor
    const content = editor.getValue();

    // Check that both delimiters are present
    const openingDelim = content.match(/^---/m);
    const closingDelim = content.match(/^---$/m);

    expect(openingDelim).not.toBeNull();
    expect(closingDelim).not.toBeNull();

    // Check that content is preserved correctly
    expect(content).toContain('node_id: 123');
    expect(content).toContain('title: Test GraphNode');
    expect(content).toContain('# Main content here');

    // Verify the structure: opening ---, content, closing ---,main content
    const lines = content.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[4]).toBe('---'); // After 3 lines of frontmatter
  });

  it('should parse frontmatter with yamlFrontmatter language support', async () => {
    const frontmatterContent = `---
node_id: 456
---
Content`;

    editor = new CodeMirrorEditorView(container, frontmatterContent);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Check that the editor recognizes the structure
    const content = editor.getValue();

    // Split and verify structure
    const lines = content.split('\n');

    // First line should be opening ---
    expect(lines[0]).toBe('---');

    // Middle should be YAML content
    expect(lines[1]).toContain('node_id:');

    // Should have closing ---
    expect(lines[2]).toBe('---');

    // Content should follow
    expect(lines[3]).toBe('Content');
  });
});
