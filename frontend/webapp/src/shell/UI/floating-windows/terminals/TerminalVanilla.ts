import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { VTSettings } from '@/pure/settings';
import { getCachedZoom, isZoomActive, subscribeToZoomChange, subscribeToZoomStart } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { getScalingStrategy, getTerminalFontSize } from '@/pure/floatingWindowScaling';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

export interface TerminalVanillaConfig {
  terminalData: TerminalData;
  container: HTMLElement;
}

/**
 * Minimal vanilla JS terminal wrapper - bare essentials only
 */
export class TerminalVanilla {
  private term: XTerm | null = null;
  private terminalId: string | null = null;
  private fitAddon: FitAddon | null = null;
  private container: HTMLElement;
  private terminalData: TerminalData;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrameId: number | null = null;
  private scrollCorrectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private suppressNextEnter: boolean = false;
  private shiftEnterSendsOptionEnter: boolean = true;
  private unsubscribeZoom: (() => void) | null = null;
  private unsubscribeZoomStart: (() => void) | null = null;
  private scrollOffsetBeforeZoom: number | null = null;

  constructor(config: TerminalVanillaConfig) {
    this.container = config.container;
    this.terminalData = config.terminalData;

    void window.electronAPI?.main.loadSettings().then(
      (settings: VTSettings) => this.shiftEnterSendsOptionEnter = settings.shiftEnterSendsOptionEnter ?? true);

    void this.mount();
  }

  private async mount(): Promise<void> {
    // Get initial zoom level for font size scaling
    const initialZoom: number = getCachedZoom();
    const initialStrategy: 'css-transform' | 'dimension-scaling' = getScalingStrategy('Terminal', initialZoom);
    const initialFontSize: number = getTerminalFontSize(initialZoom, initialStrategy);

    // Create terminal instance with zoom-scaled font size
    const term: XTerm = new XTerm({
      cursorBlink: true,
      scrollback: 9999,
      scrollOnEraseInDisplay: true,
      scrollOnUserInput: true,
      fontSize: initialFontSize,
      allowProposedApi: true, // Required for Unicode11Addon
    });

    // Add FitAddon
    const fitAddon: FitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    this.fitAddon = fitAddon;
    this.term = term;

    // Open terminal in the DOM
    term.open(this.container);

    // Load WebGL2 addon for better rendering performance
    try {
      const webglAddon: WebglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        console.warn('WebGL context lost, terminal will fall back to DOM renderer');
        webglAddon.dispose();
      });
    } catch (e) {
      console.warn('WebGL2 not supported, using default DOM renderer:', e);
    }

    // Load clipboard addon for proper copy/paste handling
    const clipboardAddon: ClipboardAddon = new ClipboardAddon();
    term.loadAddon(clipboardAddon);

    // Load search addon for find-in-terminal functionality
    const searchAddon: SearchAddon = new SearchAddon();
    term.loadAddon(searchAddon);

    // Load Unicode11 addon for better Unicode support
    const unicode11Addon: Unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    fitAddon.fit();

    // Shift+Enter -> Option+Enter: We intercept Shift+Enter and send ESC+CR (\x1b\r).
    // However, onData still fires with '\r' despite returning false from the handler.
    // The suppressNextEnter flag prevents that duplicate '\r' from being sent.
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (this.shiftEnterSendsOptionEnter && event.type === 'keydown' && event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (this.terminalId && window.electronAPI?.terminal) {
          void window.electronAPI.terminal.write(this.terminalId, '\x1b\r');
        }
        this.suppressNextEnter = true;
        return false;
      }
      return true;
    });

    // Handle terminal input
    term.onData(data => {
      // Skip the CR that onData fires after we handled Shift+Enter
      if (this.suppressNextEnter && data === '\r') {
        this.suppressNextEnter = false;
        return;
      }
      this.suppressNextEnter = false;

      if (this.terminalId && window.electronAPI?.terminal) {
        window.electronAPI.terminal.write(this.terminalId, data).catch(err => {
          console.error('Terminal write error:', err);
        });
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      if (this.terminalId && window.electronAPI?.terminal) {
        void window.electronAPI.terminal.resize(this.terminalId, cols, rows);
      }
    });

    // Set up ResizeObserver for container resize with scroll preservation
    // This is the single code path for all terminal resizing (zoom changes, manual resize, etc.)
    // Uses requestAnimationFrame to sync with browser paint cycle (~16ms) instead of fixed 50ms delay
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeFrameId !== null) {
        cancelAnimationFrame(this.resizeFrameId);
      }
      this.resizeFrameId = requestAnimationFrame(() => {
        if (!this.term || !this.fitAddon) return;

        const zoom: number = getCachedZoom();

        if (isZoomActive()) {
          // During zoom: skip fit() to avoid PTY resize/shell redraws
          // Visual scaling is handled by the parent floating window's CSS transform
          return;
        }

        // Update fontSize based on current zoom level
        const strategy: 'css-transform' | 'dimension-scaling' = getScalingStrategy('Terminal', zoom);
        this.term.options.fontSize = getTerminalFontSize(zoom, strategy);

        // Use pre-captured scroll if available (from zoomStart or expand button click),
        // otherwise capture inline. Pre-captured value is immune to auto-scroll race.
        const buffer: { baseY: number; viewportY: number } = this.term.buffer.active;
        const scrollOffset: number = this.scrollOffsetBeforeZoom ?? (buffer.baseY - buffer.viewportY);

        this.fitAddon.fit();

        // Defer scroll restoration to next frame - xterm's internal _sync()
        // schedules dimension updates via addRefreshCallback() which runs at next animation frame.
        // Calling scrollToLine() immediately operates on stale dimensions, causing scrollbar desync.
        requestAnimationFrame(() => {
          if (!this.term) return;

          // If user was near the bottom (within 10 lines), use scrollToBottom() to avoid
          // phantom scrollable black lines that appear after resize when terminal gets taller.
          // xterm.js doesn't automatically adjust scroll bounds when viewport rows increase.
          // Threshold of 10 lines allows for small variance in scroll position.
          if (scrollOffset < 10) {
            this.term.scrollToBottom();
            this.scrollOffsetBeforeZoom = null;
            return;
          }

          const newBaseY: number = this.term.buffer.active.baseY;
          const targetLine: number = newBaseY - scrollOffset;
          if (targetLine >= 0) {
            this.term.scrollToLine(targetLine);

            // Schedule delayed correction to fix scrollbar desync race condition.
            // Only re-apply if user hasn't scrolled (viewportY unchanged).
            const expectedViewportY: number = this.term.buffer.active.viewportY;
            if (this.scrollCorrectionTimeout) clearTimeout(this.scrollCorrectionTimeout);
            this.scrollCorrectionTimeout = setTimeout(() => {
              if (!this.term) return;
              if (this.term.buffer.active.viewportY === expectedViewportY) {
                this.term.scrollToLine(targetLine);
              }
            }, 100);
          }
          this.scrollOffsetBeforeZoom = null;
        });
      });
    });
    this.resizeObserver.observe(this.container);

    // Subscribe to zoom start to capture scroll position before any corruption
    this.unsubscribeZoomStart = subscribeToZoomStart(() => {
      if (!this.term) return;
      const buffer: { baseY: number; viewportY: number } = this.term.buffer.active;
      this.scrollOffsetBeforeZoom = buffer.baseY - buffer.viewportY;
    });

    // Subscribe to zoom end for guaranteed final fit after zoom stops
    this.unsubscribeZoom = subscribeToZoomChange((zoom: number) => {
      if (!this.term || !this.fitAddon) return;

      // Update font size
      const strategy: 'css-transform' | 'dimension-scaling' = getScalingStrategy('Terminal', zoom);
      this.term.options.fontSize = getTerminalFontSize(zoom, strategy);

      this.fitAddon.fit();

      // Defer scroll restoration to next frame - xterm's internal _sync()
      // schedules dimension updates via addRefreshCallback() which runs at next animation frame.
      // DON'T clear scrollOffsetBeforeZoom here - ResizeObserver may fire later
      // and needs the same uncorrupted value to avoid race with auto-scroll
      if (this.scrollOffsetBeforeZoom !== null) {
        const scrollOffset: number = this.scrollOffsetBeforeZoom;
        requestAnimationFrame(() => {
          if (!this.term) return;

          // If user was near the bottom (within 10 lines), use scrollToBottom() to avoid
          // phantom scrollable black lines that appear after resize when terminal gets taller.
          if (scrollOffset < 10) {
            this.term.scrollToBottom();
            return;
          }

          const newBaseY: number = this.term.buffer.active.baseY;
          const targetLine: number = newBaseY - scrollOffset;
          if (targetLine >= 0) {
            this.term.scrollToLine(targetLine);

            // Schedule delayed correction to fix scrollbar desync race condition.
            // Only re-apply if user hasn't scrolled (viewportY unchanged).
            const expectedViewportY: number = this.term.buffer.active.viewportY;
            if (this.scrollCorrectionTimeout) clearTimeout(this.scrollCorrectionTimeout);
            this.scrollCorrectionTimeout = setTimeout(() => {
              if (!this.term) return;
              if (this.term.buffer.active.viewportY === expectedViewportY) {
                this.term.scrollToLine(targetLine);
              }
            }, 100);
          }
        });
      }
    });

    // Initialize terminal backend connection
    await this.initTerminal();
  }

  private async initTerminal(): Promise<void> {
    if (!window.electronAPI?.terminal || !this.term) {
      this.term?.writeln('Terminal is only available in Electron mode.');
      this.term?.writeln('Run the app with: npm run electron:dev');
      return;
    }

    const result: { success: boolean; terminalId?: string; error?: string } = await window.electronAPI.terminal.spawn(this.terminalData);

    if (result.success && result.terminalId) {
      this.terminalId = result.terminalId;

      // Sync initial size
      if (this.term) {
        void window.electronAPI.terminal.resize(result.terminalId, this.term.cols, this.term.rows);
      }

      // Handle terminal output
      window.electronAPI.terminal.onData((id, data) => {
        if (id === result.terminalId && this.term) {
          this.term.write(data);
        }
      });

      // Handle terminal exit
      window.electronAPI.terminal.onExit((id, code) => {
        if (id === result.terminalId && this.term) {
          this.term.writeln(`\r\nProcess exited with code ${code}`);
          this.terminalId = null;
        }
      });
    } else {
      this.term?.writeln('Failed to spawn terminal: ' + (result.error ?? 'Unknown error'));
    }
  }


  /**
   * Focus the terminal so it receives keyboard input
   */
  focus(): void {
    this.term?.focus();
  }

  /**
   * Scroll terminal to the bottom (latest output)
   */
  scrollToBottom(): void {
    this.term?.scrollToBottom();
    // Update saved scroll offset so zoom restoration respects this intentional scroll
    this.scrollOffsetBeforeZoom = 0;
  }

  /**
   * Cleanup and destroy the terminal
   */
  dispose(): void {
    if (this.resizeFrameId !== null) {
      cancelAnimationFrame(this.resizeFrameId);
    }

    if (this.scrollCorrectionTimeout) {
      clearTimeout(this.scrollCorrectionTimeout);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.unsubscribeZoom) {
      this.unsubscribeZoom();
    }

    if (this.unsubscribeZoomStart) {
      this.unsubscribeZoomStart();
    }

    // Kill terminal process
    if (this.terminalId && window.electronAPI?.terminal) {
      void window.electronAPI.terminal.kill(this.terminalId);
    }

    // Dispose terminal instance
    this.term?.dispose();
  }
}
