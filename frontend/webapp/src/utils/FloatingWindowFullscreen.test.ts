import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingWindowFullscreen } from '@/utils/FloatingWindowFullscreen';

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

  it('should initialize and track fullscreen state', () => {
    fullscreen = new FloatingWindowFullscreen(container);

    // Initially not fullscreen
    expect(fullscreen.isFullscreen()).toBe(false);
  });

  it('should call requestFullscreen when entering fullscreen', async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    container.requestFullscreen = requestFullscreenMock;

    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it('should call exitFullscreen when exiting fullscreen', async () => {
    const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'exitFullscreen', {
      value: exitFullscreenMock,
      writable: true,
      configurable: true
    });

    // Mock fullscreen state
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true
    });

    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.exit();

    expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
  });

  it('should toggle fullscreen state', async () => {
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

    // Simulate fullscreen change event
    const event = new Event('fullscreenchange');
    document.dispatchEvent(event);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should cleanup on dispose', async () => {
    const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'exitFullscreen', {
      value: exitFullscreenMock,
      writable: true,
      configurable: true
    });

    // Mock fullscreen state
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true
    });

    const callback = vi.fn();
    fullscreen = new FloatingWindowFullscreen(container, callback);

    // Dispose should exit fullscreen and remove listeners
    fullscreen.dispose();

    expect(exitFullscreenMock).toHaveBeenCalledTimes(1);

    // Simulate fullscreen change event after dispose
    const event = new Event('fullscreenchange');
    document.dispatchEvent(event);

    // Callback should not be invoked after dispose
    expect(callback).toHaveBeenCalledTimes(0);
  });

  it('should handle errors gracefully when entering fullscreen fails', async () => {
    const requestFullscreenMock = vi.fn().mockRejectedValue(new Error('Fullscreen not allowed'));
    container.requestFullscreen = requestFullscreenMock;

    // Mock console.error to verify error is logged
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.enter();

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should handle errors gracefully when exiting fullscreen fails', async () => {
    const exitFullscreenMock = vi.fn().mockRejectedValue(new Error('Exit fullscreen failed'));
    Object.defineProperty(document, 'exitFullscreen', {
      value: exitFullscreenMock,
      writable: true,
      configurable: true
    });

    // Mock fullscreen state
    Object.defineProperty(document, 'fullscreenElement', {
      value: container,
      writable: true,
      configurable: true
    });

    // Mock console.error to verify error is logged
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    fullscreen = new FloatingWindowFullscreen(container);

    await fullscreen.exit();

    expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
