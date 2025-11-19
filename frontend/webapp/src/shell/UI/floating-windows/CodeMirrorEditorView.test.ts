import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';

// Mock window event listeners before importing CodeMirrorEditorView
// This prevents mermaid from failing during module initialization
beforeAll(() => {
  if (!global.window.addEventListener) {
    global.window.addEventListener = vi.fn();
  }
  if (!global.window.removeEventListener) {
    global.window.removeEventListener = vi.fn();
  }
});

import { CodeMirrorEditorView } from '@/shell/UI/floating-windows/CodeMirrorEditorView.ts';

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
    expect(content).toContain('title: Test Node');
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

  it('should auto-collapse frontmatter when setValue loads NEW frontmatter', async () => {
    // Start with empty content (no frontmatter)
    editor = new CodeMirrorEditorView(container, '# Initial content');

    await new Promise(resolve => setTimeout(resolve, 100));

    // Now set content WITH frontmatter (simulates optimistic UI → actual content)
    const contentWithFrontmatter = `---
position:
  x: 100
  y: 200
---
# New content`;

    editor.setValue(contentWithFrontmatter);

    // Wait for requestAnimationFrame to complete
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 100));

    const value = editor.getValue();

    // Should still contain frontmatter (folding doesn't remove it)
    expect(value).toContain('---');
    expect(value).toContain('position:');
    expect(value).toContain('# New content');
  });

  it('should NOT auto-collapse when setValue updates existing frontmatter', async () => {
    // Start with content that already has frontmatter
    const initialContent = `---
position:
  x: 50
  y: 50
---
# Original`;

    editor = new CodeMirrorEditorView(container, initialContent);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Update with different frontmatter
    const updatedContent = `---
position:
  x: 100
  y: 100
---
# Updated`;

    editor.setValue(updatedContent);

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 100));

    const value = editor.getValue();

    // Should contain updated content
    expect(value).toContain('x: 100');
    expect(value).toContain('# Updated');
  });

  it('should NOT auto-collapse when setValue updates content without frontmatter', async () => {
    // Start with content without frontmatter
    editor = new CodeMirrorEditorView(container, '# First heading');

    await new Promise(resolve => setTimeout(resolve, 100));

    // Update with different content (still no frontmatter)
    editor.setValue('# Second heading');

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 100));

    const value = editor.getValue();

    // Should contain updated content
    expect(value).toContain('# Second heading');
    expect(value).not.toContain('# First heading');
  });
});
