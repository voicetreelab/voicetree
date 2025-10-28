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
});
