/**
 * FloatingWindowFullscreen - Shared fullscreen utility for floating window components
 *
 * Provides a clean API for fullscreen functionality with automatic cleanup.
 * Used by TerminalVanilla, CodeMirrorEditorView, and other floating window components.
 */
export class FloatingWindowFullscreen {
  private container: HTMLElement;
  private fullscreenChangeHandler: (() => void) | null = null;
  private onFullscreenChange?: () => void;

  /**
   * Create a new fullscreen manager for a container element
   * @param container - The DOM element to make fullscreen
   * @param onFullscreenChange - Optional callback invoked when fullscreen state changes
   */
  constructor(container: HTMLElement, onFullscreenChange?: () => void) {
    this.container = container;
    this.onFullscreenChange = onFullscreenChange;
    this.setupFullscreenListener();
  }

  /**
   * Setup listener for fullscreen state changes
   */
  private setupFullscreenListener(): void {
    this.fullscreenChangeHandler = () => {
      // Call user callback if provided
      if (this.onFullscreenChange) {
        this.onFullscreenChange();
      }
    };
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
  }

  /**
   * Enter fullscreen mode
   */
  async enter(): Promise<void> {
    try {
      await this.container.requestFullscreen();
    } catch (err) {
      console.error('Failed to enter fullscreen:', err);
    }
  }

  /**
   * Exit fullscreen mode
   */
  async exit(): Promise<void> {
    try {
      if (document.fullscreenElement === this.container) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Failed to exit fullscreen:', err);
    }
  }

  /**
   * Toggle fullscreen mode
   */
  async toggle(): Promise<void> {
    if (this.isFullscreen()) {
      await this.exit();
    } else {
      await this.enter();
    }
  }

  /**
   * Check if currently in fullscreen mode
   */
  isFullscreen(): boolean {
    return document.fullscreenElement === this.container;
  }

  /**
   * Cleanup - remove listeners and exit fullscreen if active
   */
  dispose(): void {
    if (this.fullscreenChangeHandler) {
      document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
      this.fullscreenChangeHandler = null;
    }

    // Exit fullscreen if active
    if (this.isFullscreen()) {
      document.exitFullscreen().catch(console.error);
    }
  }
}
