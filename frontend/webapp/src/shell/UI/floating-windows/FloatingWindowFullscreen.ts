/**
 * FloatingWindowFullscreen - Expands floating windows to fill the Electron window
 *
 * Uses CSS position:fixed instead of native requestFullscreen() for better UX on macOS.
 * Reparents element to document.body to escape CSS transform containment from graph overlay.
 */
export class FloatingWindowFullscreen {
  private container: HTMLElement;
  private onFullscreenChange?: () => void;
  private isExpanded: boolean = false;
  private originalStyles: Record<string, string> | null = null;
  private originalParent: HTMLElement | null = null;
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement, onFullscreenChange?: () => void) {
    this.container = container;
    this.onFullscreenChange = onFullscreenChange;
  }

  async enter(): Promise<void> {
    if (this.isExpanded) return;

    // Save original parent for restoration
    this.originalParent = this.container.parentElement;

    // Save original inline styles for restoration
    const s: CSSStyleDeclaration = this.container.style;
    this.originalStyles = {
      position: s.position,
      top: s.top,
      left: s.left,
      width: s.width,
      height: s.height,
      zIndex: s.zIndex,
      transform: s.transform,
    };

    // Move to document.body to escape transform containment from graph overlay
    document.body.appendChild(this.container);

    // Expand to fill entire window using fixed positioning
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '10000',
      transform: 'none',
    });

    // Add Escape key handler to exit fullscreen
    this.escapeHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        void this.exit();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);

    this.isExpanded = true;
    this.onFullscreenChange?.();
  }

  async exit(): Promise<void> {
    if (!this.isExpanded || !this.originalStyles || !this.originalParent) return;

    // Remove Escape key handler
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    // Restore original styles
    Object.assign(this.container.style, this.originalStyles);

    // Move back to original parent
    this.originalParent.appendChild(this.container);

    this.originalStyles = null;
    this.originalParent = null;
    this.isExpanded = false;
    this.onFullscreenChange?.();
  }

  async toggle(): Promise<void> {
    if (this.isExpanded) {
      await this.exit();
    } else {
      await this.enter();
    }
  }

  isFullscreen(): boolean {
    return this.isExpanded;
  }

  dispose(): void {
    // Remove Escape key handler
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
    }

    if (this.isExpanded && this.originalStyles && this.originalParent) {
      Object.assign(this.container.style, this.originalStyles);
      this.originalParent.appendChild(this.container);
      this.isExpanded = false;
      this.originalStyles = null;
      this.originalParent = null;
    }
  }
}
