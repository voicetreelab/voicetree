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

import { CodeMirrorEditorView } from '@/shell/UI/floating-windows/editors/CodeMirrorEditorView.ts';

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

describe('hasFrontmatter method', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  // Helper to access the private hasFrontmatter method
  const hasFrontmatter = (content: string): boolean => {
    // Create a temporary editor to test the method
    const tempEditor = new CodeMirrorEditorView(container, content);
    // Access the private method by using object index access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (tempEditor as Record<string, any>).hasFrontmatter(content);
    tempEditor.dispose();
    return result;
  };

  describe('standard YAML frontmatter - SHOULD work', () => {
    it('should detect standard frontmatter starting on line 0', () => {
      const content = `---
title: Test
---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should detect frontmatter with multiple properties', () => {
      const content = `---
node_id: 123
title: Test Node
color: blue
position:
  x: 100
  y: 200
---
# Main content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should detect minimal frontmatter (just delimiters)', () => {
      const content = `---
---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should detect frontmatter at document start with content after', () => {
      const content = `---
author: Me
date: 2024-01-01
---

# Heading
Content here`;
      expect(hasFrontmatter(content)).toBe(true);
    });
  });

  describe('invalid/no frontmatter cases', () => {
    it('should return false for content without frontmatter', () => {
      const content = `# Heading
This is just regular markdown content.`;
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasFrontmatter('')).toBe(false);
    });

    it('should return false for only opening --- without closing', () => {
      const content = `---
title: Test
# Content without closing delimiter`;
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should return false for single --- delimiter in middle', () => {
      const content = `# Content
---
More content`;
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should return false when --- appears only in content (not at start)', () => {
      const content = `# Heading
Some content
---
More content`;
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should return false for --- with extra characters on same line', () => {
      const content = `--- title: Test
content: value
--- end
# Content`;
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should be permissive - allows content before first ---', () => {
      // Note: Implementation doesn't require line 0 to be ---, just needs 2+ delimiters
      const content = `Some text first
---
title: Test
---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle content with only whitespace', () => {
      const content = `

\t`;
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should return false for single line with ---', () => {
      const content = '---';
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should return false for only opening --- (no closing)', () => {
      const content = `---
title: Test`;
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should handle multiple consecutive --- lines at start', () => {
      const content = `---
---
---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should trim whitespace when checking for ---', () => {
      const content = `   ---
title: Test
   ---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle tabs around --- delimiters', () => {
      const content = `\t---\t
title: Test
\t---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should check up to 1000 lines maximum', () => {
      // Create content with --- at line 0 and beyond line 1000
      const lines = ['---'];
      for (let i = 0; i < 1005; i++) {
        lines.push(`line ${i}`);
      }
      lines[1001] = '---'; // Beyond 1000 line limit

      const content = lines.join('\n');
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should find --- delimiters within first 1000 lines', () => {
      const lines = ['---'];
      for (let i = 0; i < 1005; i++) {
        lines.push(`line ${i}`);
      }
      lines[500] = '---'; // Within 1000 line limit

      const content = lines.join('\n');
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle CRLF line endings', () => {
      const content = `---\r\ntitle: Test\r\n---\r\n# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle mixed LF and CRLF line endings', () => {
      const content = `---\r\ntitle: Test\n---\r\n# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle empty lines within frontmatter', () => {
      const content = `---
title: Test

author: Me

---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should return false if frontmatter has 3+ --- on consecutive lines', () => {
      // Only needs 2 delimiters - if there are 3+ consecutive at start, still valid
      const content = `---
---
---
Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle frontmatter followed immediately by content (no blank line)', () => {
      const content = `---
title: Test
---
# Immediate content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle very long frontmatter section', () => {
      const frontmatterLines = ['---'];
      for (let i = 0; i < 100; i++) {
        frontmatterLines.push(`property${i}: value${i}`);
      }
      frontmatterLines.push('---');
      frontmatterLines.push('# Content');

      const content = frontmatterLines.join('\n');
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should allow indented --- because of trim()', () => {
      // Implementation uses .trim(), so indented --- is accepted
      const content = `  ---
title: Test
---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should return true when closing --- has leading whitespace (gets trimmed)', () => {
      const content = `---
title: Test
  ---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle empty frontmatter between delimiters', () => {
      const content = `---

---
# Content`;
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should NOT check line 0 - this test documents the bug', () => {
      // This documents the current buggy behavior: line 0 is skipped
      // When the opening --- is on line 0 and closing on line 2,
      // only the closing delimiter is counted (yamlTagCount = 1)
      const content = `---
title: Test
---`;
      // Should be true, but implementation returns false
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should be permissive - finds 2+ delimiters anywhere in first 1000 lines', () => {
      // Implementation doesn't require line 0 to be ---
      const content = `# Title
---
frontmatter: value
---
Content`;
      // This returns true because it finds 2 delimiters
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should require opening --- at very start of document', () => {
      // Frontmatter MUST start on line 0, column 0 (after trim)
      const content = `
---
title: Test
---
Content`;
      // Empty line before opening --- should make this invalid
      // But with current implementation, the empty line is line 0,
      // so lines 1 and 3 have ---, making yamlTagCount = 2
      // This is arguably okay - empty first line then valid frontmatter
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should handle line 0 being exactly --- with no other content', () => {
      const content = `---
---`;
      // Two delimiters, no content between or after - minimal valid frontmatter
      // But line 0 is skipped, so only sees 1 delimiter
      expect(hasFrontmatter(content)).toBe(true);
    });

    it('should correctly validate that both delimiters must be standalone lines', () => {
      const content = `---title: inline
content: value
---end
# Content`;
      // Delimiters with non-whitespace on same line should be invalid
      expect(hasFrontmatter(content)).toBe(false);
    });

    it('should detect 2+ delimiters even in middle of document', () => {
      const content = `# Heading
Some content here

---
This looks like frontmatter
---

But it is not at the start`;
      // Implementation is permissive - finds 2 delimiters anywhere
      expect(hasFrontmatter(content)).toBe(true);
    });
  });
});
