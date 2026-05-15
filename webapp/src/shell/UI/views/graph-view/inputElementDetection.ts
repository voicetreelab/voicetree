/**
 * Check if the event target is an input element (terminal, editor, textarea, etc.)
 * Uses composedPath() to look through Shadow DOM boundaries for the actual target.
 */
export function isInputElement(element: HTMLElement | null, event?: KeyboardEvent): boolean {
  if (!element) return false;

  // Get all elements in the composed path (including Shadow DOM internals)
  const elementsToCheck: HTMLElement[] = [element];
  if (event) {
    const composedPath: EventTarget[] = event.composedPath();
    for (const target of composedPath) {
      if (target instanceof HTMLElement) {
        elementsToCheck.push(target);
      }
    }
  }

  for (const el of elementsToCheck) {
    // Check if element is editable
    if (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true'
    ) {
      return true;
    }

    // Check for xterm terminal (has class 'xterm' or parent has class 'xterm-screen')
    if (
      el.classList.contains('xterm') ||
      el.classList.contains('xterm-screen') ||
      el.closest('.xterm')
    ) {
      return true;
    }

    // Check for CodeMirror editor
    if (
      el.classList.contains('cm-content') ||
      el.classList.contains('cm-editor') ||
      el.closest('.cm-editor')
    ) {
      return true;
    }
  }

  return false;
}
