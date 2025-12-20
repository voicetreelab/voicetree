import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { FloatingWindowFullscreen } from '@/shell/UI/floating-windows/FloatingWindowFullscreen';

describe('FloatingWindowFullscreen', () => {
  let container: HTMLElement;
  let originalParent: HTMLElement;
  let fullscreen: FloatingWindowFullscreen;

  beforeEach(() => {
    // Create a parent element to simulate the graph overlay with transforms
    originalParent = document.createElement('div');
    originalParent.className = 'cy-floating-overlay';
    originalParent.style.transform = 'translate(100px, 50px) scale(1.5)';
    document.body.appendChild(originalParent);

    container = document.createElement('div');
    originalParent.appendChild(container);
  });

  afterEach(() => {
    if (fullscreen) {
      fullscreen.dispose();
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    if (originalParent.parentNode) {
      originalParent.parentNode.removeChild(originalParent);
    }
  });

  it('should initialize with non-fullscreen state', () => {
    fullscreen = new FloatingWindowFullscreen(container);

    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should expand to full window on enter', async () => {
    fullscreen = new FloatingWindowFullscreen(container);
    await fullscreen.enter();

    expect(container.style.position).toBe('fixed');
    expect(container.style.top).toBe('0px');
    expect(container.style.left).toBe('0px');
    expect(container.style.width).toBe('100vw');
    expect(container.style.height).toBe('100vh');
    expect(container.style.zIndex).toBe('10000');
    expect(container.style.transform).toBe('none');
    expect(fullscreen.isFullscreen()).toBe(true);
  });

  it('should restore original styles on exit', async () => {
    container.style.width = '400px';
    container.style.height = '300px';
    container.style.position = 'absolute';
    container.style.top = '50px';
    container.style.left = '100px';

    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();
    expect(fullscreen.isFullscreen()).toBe(true);

    await fullscreen.exit();

    expect(container.style.width).toBe('400px');
    expect(container.style.height).toBe('300px');
    expect(container.style.position).toBe('absolute');
    expect(container.style.top).toBe('50px');
    expect(container.style.left).toBe('100px');
    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should toggle between expanded and normal states', async () => {
    fullscreen = new FloatingWindowFullscreen(container);

    // Toggle to expanded
    await fullscreen.toggle();
    expect(fullscreen.isFullscreen()).toBe(true);
    expect(container.style.position).toBe('fixed');

    // Toggle back to normal
    await fullscreen.toggle();
    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should invoke callback on enter and exit', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callback: Mock<(...args: any[]) => any> = vi.fn();
    fullscreen = new FloatingWindowFullscreen(container, callback);

    await fullscreen.enter();
    expect(callback).toHaveBeenCalledTimes(1);

    await fullscreen.exit();
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should not invoke callback after dispose', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callback: Mock<(...args: any[]) => any> = vi.fn();
    fullscreen = new FloatingWindowFullscreen(container, callback);

    await fullscreen.enter();
    callback.mockClear();

    fullscreen.dispose();

    // Callback should not be invoked after dispose
    expect(callback).toHaveBeenCalledTimes(0);
  });

  it('should restore styles on dispose if expanded', async () => {
    container.style.width = '400px';
    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();
    expect(container.style.width).toBe('100vw');

    fullscreen.dispose();

    expect(container.style.width).toBe('400px');
    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should not enter fullscreen twice', async () => {
    container.style.width = '400px';
    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();
    const firstZIndex: string = container.style.zIndex;

    // Try to enter again
    await fullscreen.enter();

    // Should still be the same state
    expect(container.style.zIndex).toBe(firstZIndex);
    expect(fullscreen.isFullscreen()).toBe(true);
  });

  it('should not exit when not expanded', async () => {
    container.style.width = '400px';
    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.exit();

    // Should maintain original style
    expect(container.style.width).toBe('400px');
    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should reparent to document.body on enter to escape transform containment', async () => {
    fullscreen = new FloatingWindowFullscreen(container);

    // Container starts inside originalParent (simulated graph overlay)
    expect(container.parentElement).toBe(originalParent);

    await fullscreen.enter();

    // Container should now be direct child of document.body
    expect(container.parentElement).toBe(document.body);
    expect(fullscreen.isFullscreen()).toBe(true);
  });

  it('should reparent back to original parent on exit', async () => {
    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();
    expect(container.parentElement).toBe(document.body);

    await fullscreen.exit();

    // Container should be back in originalParent
    expect(container.parentElement).toBe(originalParent);
    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should reparent back to original parent on dispose', async () => {
    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();
    expect(container.parentElement).toBe(document.body);

    fullscreen.dispose();

    // Container should be back in originalParent
    expect(container.parentElement).toBe(originalParent);
    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should exit fullscreen on Escape key press', async () => {
    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();
    expect(fullscreen.isFullscreen()).toBe(true);
    expect(container.parentElement).toBe(document.body);

    // Simulate Escape key press
    const escapeEvent: KeyboardEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(escapeEvent);

    // Wait for async exit to complete
    await new Promise<void>(resolve => setTimeout(resolve, 10));

    expect(fullscreen.isFullscreen()).toBe(false);
    expect(container.parentElement).toBe(originalParent);
  });

  it('should not react to Escape key when not in fullscreen', async () => {
    fullscreen = new FloatingWindowFullscreen(container);

    expect(fullscreen.isFullscreen()).toBe(false);

    // Simulate Escape key press (should do nothing)
    const escapeEvent: KeyboardEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(escapeEvent);

    await new Promise<void>(resolve => setTimeout(resolve, 10));

    expect(fullscreen.isFullscreen()).toBe(false);
    expect(container.parentElement).toBe(originalParent);
  });

  it('should remove Escape key handler on exit', async () => {
    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();
    await fullscreen.exit();

    // Enter again and verify Escape still works (handler was properly cleaned up and re-added)
    await fullscreen.enter();
    expect(fullscreen.isFullscreen()).toBe(true);

    const escapeEvent: KeyboardEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(escapeEvent);

    await new Promise<void>(resolve => setTimeout(resolve, 10));

    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should remove Escape key handler on dispose', async () => {
    const removeEventListenerSpy: ReturnType<typeof vi.spyOn> = vi.spyOn(document, 'removeEventListener');

    fullscreen = new FloatingWindowFullscreen(container);
    await fullscreen.enter();

    fullscreen.dispose();

    // Verify removeEventListener was called for keydown
    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    removeEventListenerSpy.mockRestore();
  });
});
