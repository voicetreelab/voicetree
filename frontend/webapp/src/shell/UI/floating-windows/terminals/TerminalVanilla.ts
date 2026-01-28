import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { VTSettings } from '@/pure/settings';
import { getCachedZoom, onZoomEnd, isZoomActive } from '@/shell/edge/UI-edge/floating-windows/cytoscape-floating-windows';
import { getScalingStrategy, getTerminalFontSize, getScreenDimensions, getWindowTransform } from '@/pure/floatingWindowScaling';
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
  private suppressNextEnter: boolean = false;
  private shiftEnterSendsOptionEnter: boolean = true;
  private zoomEndUnsubscribe: (() => void) | null = null;

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
    // Uses requestAnimationFrame to sync with browser paint cycle
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeFrameId !== null) {
        cancelAnimationFrame(this.resizeFrameId);
      }
      this.resizeFrameId = requestAnimationFrame(() => {
        if (!this.term || !this.fitAddon) return;

        // Skip fit during active zoom or pending dimension update - handled by handleZoomEnd()
        const windowElement: HTMLElement | null = this.container.closest('.cy-floating-window') as HTMLElement | null;
        if (isZoomActive() || windowElement?.dataset.pendingDimensionUpdate === 'true') {
          return;
        }

        // Update fontSize based on current zoom level
        const zoom: number = getCachedZoom();
        const strategy: 'css-transform' | 'dimension-scaling' = getScalingStrategy('Terminal', zoom);
        this.term.options.fontSize = getTerminalFontSize(zoom, strategy);

        // Save scroll position before fit (fit changes row count which can reset scroll)
        const buffer: { baseY: number; viewportY: number } = this.term.buffer.active;
        const scrollOffset: number = buffer.baseY - buffer.viewportY; // lines scrolled up from bottom

        this.fitAddon.fit();

        // Restore scroll position after fit
        const newBaseY: number = this.term.buffer.active.baseY;
        const targetLine: number = newBaseY - scrollOffset;
        if (targetLine >= 0) {
          this.term.scrollToLine(targetLine);
        }
      });
    });
    this.resizeObserver.observe(this.container);

    // Subscribe to zoom-end callback for deferred dimension updates
    this.zoomEndUnsubscribe = onZoomEnd(() => this.handleZoomEnd());

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
  }

  /**
   * Handle zoom end - apply deferred dimension scaling with scroll preservation
   * Called after zoom settles (100ms debounce) to prevent flickering during zoom
   */
  private handleZoomEnd(): void {
    if (!this.term || !this.fitAddon) return;

    const windowElement: HTMLElement | null = this.container.closest('.cy-floating-window') as HTMLElement | null;
    if (!windowElement || windowElement.dataset.pendingDimensionUpdate !== 'true') return;

    delete windowElement.dataset.pendingDimensionUpdate;

    const zoom: number = getCachedZoom();
    const strategy: 'css-transform' | 'dimension-scaling' = getScalingStrategy('Terminal', zoom);
    if (strategy !== 'dimension-scaling') return;

    // Store scroll position before resize
    const buffer: { baseY: number; viewportY: number } = this.term.buffer.active;
    const scrollOffset: number = buffer.baseY - buffer.viewportY;

    // 1. Update window container dimensions (switch from CSS-transform to dimension-scaling)
    const baseWidth: number = parseFloat(windowElement.dataset.baseWidth ?? '400');
    const baseHeight: number = parseFloat(windowElement.dataset.baseHeight ?? '400');
    const screenDimensions: { readonly width: number; readonly height: number } = getScreenDimensions(
      { width: baseWidth, height: baseHeight },
      zoom,
      strategy
    );
    windowElement.style.width = `${screenDimensions.width}px`;
    windowElement.style.height = `${screenDimensions.height}px`;
    windowElement.dataset.usingCssTransform = 'false';

    // 2. Update window transform (remove CSS scale, keep centering)
    windowElement.style.transform = getWindowTransform(strategy, zoom, 'center');

    // 3. Update title bar compensation for dimension-scaling mode
    const titleBar: HTMLElement | null = windowElement.querySelector('.terminal-title-bar');
    if (titleBar) {
      const titleBarBaseHeight: number = 28;
      titleBar.style.width = `${100 / zoom}%`;
      titleBar.style.transform = `scale(${zoom})`;
      titleBar.style.transformOrigin = 'top left';
      titleBar.style.marginBottom = `${-titleBarBaseHeight * (1 - zoom)}px`;
    }

    // 4. Apply terminal font scaling and fit
    this.term.options.fontSize = getTerminalFontSize(zoom, strategy);
    this.fitAddon.fit();

    // 5. Restore scroll position
    const restoreScroll = (): void => {
      if (!this.term) return;
      const newBaseY: number = this.term.buffer.active.baseY;
      const targetLine: number = newBaseY - scrollOffset;
      if (targetLine >= 0) this.term.scrollToLine(targetLine);
    };

    // Restore immediately and again after 500ms for reliability
    restoreScroll();
    setTimeout(restoreScroll, 500);
  }

  /**
   * Cleanup and destroy the terminal
   */
  dispose(): void {
    if (this.resizeFrameId !== null) {
      cancelAnimationFrame(this.resizeFrameId);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Unsubscribe from zoom-end callbacks
    this.zoomEndUnsubscribe?.();
    this.zoomEndUnsubscribe = null;

    // Kill terminal process
    if (this.terminalId && window.electronAPI?.terminal) {
      void window.electronAPI.terminal.kill(this.terminalId);
    }

    // Dispose terminal instance
    this.term?.dispose();
  }
}
