import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingWindowFullscreen } from '@/shell/UI/floating-windows/FloatingWindowFullscreen.ts';

describe('FloatingWindowFullscreen', () => {
  let container: HTMLElement;
  let fullscreen: FloatingWindowFullscreen;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (fullscreen) {
      fullscreen.dispose();
    }
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it('should initialize with non-fullscreen state', () => {
    fullscreen = new FloatingWindowFullscreen(container);

    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should toggle between fullscreen and non-fullscreen states', async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
    container.requestFullscreen = requestFullscreenMock;
    Object.defineProperty(document, 'exitFullscreen', {
      value: exitFullscreenMock,
      writable: true,
      configurable: true
    });

    fullscreen = new FloatingWindowFullscreen(container);

    // Toggle from non-fullscreen to fullscreen
    await fullscreen.toggle();
    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);

    // Mock fullscreen state change
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true
    });

    // Toggle from fullscreen to non-fullscreen
    await fullscreen.toggle();
    expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it('should invoke callback on fullscreen change events', async () => {
    const callback = vi.fn();
    fullscreen = new FloatingWindowFullscreen(container, callback);

    const event = new Event('fullscreenchange');
    document.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should remove event listeners and not invoke callback after dispose', async () => {
    const callback = vi.fn();
    fullscreen = new FloatingWindowFullscreen(container, callback);

    fullscreen.dispose();

    const event = new Event('fullscreenchange');
    document.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(0);
  });
});
