import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import './terminal-chrome.css'; // Terminal title bar, context badge, active state styles
import type { VTSettings } from '@vt/graph-model/settings';
import { isZoomActive } from '@/shell/edge/UI-edge/floating-windows/anchoring/cytoscape-floating-windows';
import { getCyInstance } from '@/shell/edge/UI-edge/state/controllers/cytoscape-state';
import { getTerminalFontSize, getScrollOffset, getScrollTargetLine } from '@vt/graph-model/floating-windows';
import { setupTerminalInteractionStrategy } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalInteractionStrategy';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {TerminalRelayClient, type RelayConnectionStatus} from './terminalRelayClient';

// Chromium caps at ~16 WebGL contexts total; stay well under to leave headroom for
// cytoscape minimap, extensions, etc. Terminals beyond this cap use the DOM renderer.
let activeWebGLContextCount: number = 0;
const MAX_WEBGL_CONTEXTS: number = 8;

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
  private suppressNextEnter: boolean = false;
  private shiftEnterSendsOptionEnter: boolean = true;
  private zoomEndUnsubscribe: (() => void) | null = null;
  private hasWebGLContext: boolean = false;
  private cleanupOnData: (() => void) | null = null;
  private cleanupOnExit: (() => void) | null = null;
  private relayClient: TerminalRelayClient | null = null;
  private relayStatusEl: HTMLDivElement | null = null;
  private terminalBackend: 'node-pty' | 'tmux' = 'node-pty';
  private readonly settingsPromise: Promise<VTSettings | null>;

  constructor(config: TerminalVanillaConfig) {
    this.container = config.container;
    this.terminalData = config.terminalData;
    this.settingsPromise = window.electronAPI?.main.loadSettings()
      .then((settings: VTSettings) => settings)
      .catch((error: unknown) => {
        console.error('[TerminalVanilla] Failed to load settings:', error);
        return null;
      }) ?? Promise.resolve(null);

    void this.settingsPromise.then((settings: VTSettings | null) => {
      this.shiftEnterSendsOptionEnter = settings?.shiftEnterSendsOptionEnter ?? true;
    });

    void this.mount();
  }

  private async mount(): Promise<void> {
    // Initial font: always css-transform (= base font size).
    // dimension-scaling is applied on user interaction (pointerdown).
    const initialFontSize: number = getTerminalFontSize(getCyInstance().zoom(), 'css-transform');

    // Create terminal instance with zoom-scaled font size
    const term: XTerm = new XTerm({
      cursorBlink: true,
      scrollback: 10000,
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

    // Load WebGL2 addon only if under the context limit (Chromium caps at ~16)
    if (activeWebGLContextCount < MAX_WEBGL_CONTEXTS) {
      try {
        const webglAddon: WebglAddon = new WebglAddon();
        term.loadAddon(webglAddon);
        activeWebGLContextCount++;
        this.hasWebGLContext = true;
        webglAddon.onContextLoss(() => {
          console.warn('WebGL context lost, terminal will fall back to DOM renderer');
          webglAddon.dispose();
          activeWebGLContextCount--;
          this.hasWebGLContext = false;
        });
      } catch (e) {
        console.warn('WebGL2 not supported, using default DOM renderer:', e);
      }
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
        void this.writeToBackend('\x1b\r');
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

      void this.writeToBackend(data);
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      // Debug: warn when xterm reports unreasonably large dimensions
      if (cols > 500 || rows > 200) {
        const windowElement: HTMLElement | null = this.container.closest('.cy-floating-window') as HTMLElement | null;
        const zoom: number = getCyInstance().zoom();
        console.warn(
          `[TerminalVanilla] OVERSIZED xterm resize: ${cols}×${rows} (cols×rows)`,
          {
            terminalId: this.terminalId,
            zoom,
            containerWidth: this.container.offsetWidth,
            containerHeight: this.container.offsetHeight,
            windowWidth: windowElement?.offsetWidth,
            windowHeight: windowElement?.offsetHeight,
            baseWidth: windowElement?.dataset.baseWidth,
            baseHeight: windowElement?.dataset.baseHeight,
            usingCssTransform: windowElement?.dataset.usingCssTransform,
            fontSize: this.term?.options.fontSize,
          }
        );
        console.trace('[TerminalVanilla] OVERSIZED xterm resize stack trace');
      }

      void this.resizeBackend(cols, rows);
    });

    // Set up ResizeObserver for container resize with scroll preservation.
    // IMPORTANT: Runs synchronously (no RAF wrapper). ResizeObserver fires during the browser's
    // layout phase (before paint) and already batches multiple resize events into one callback.
    // Previously, wrapping in requestAnimationFrame caused a 1-frame visual flicker during zoom
    // settle: the container would update in frame N, but the terminal font/fit in frame N+1,
    // causing a momentary size mismatch and scrollbar flash. Running synchronously ensures
    // both container and terminal update in the same paint frame.
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.term || !this.fitAddon) return;

      const windowElement: HTMLElement | null = this.container.closest('.cy-floating-window') as HTMLElement | null;
      const zoomActive: boolean = isZoomActive();

      // Read effective strategy from DOM (written by updateWindowFromZoom)
      const zoom: number = getCyInstance().zoom();
      const storedStrategy: string | undefined = windowElement?.dataset.activeStrategy;
      const strategy: 'css-transform' | 'dimension-scaling' =
          storedStrategy === 'dimension-scaling' ? 'dimension-scaling' : 'css-transform';
      this.term.options.fontSize = getTerminalFontSize(zoom, strategy);

      // Skip fit during active zoom — css-transform handles visuals
      if (zoomActive) {
        return;
      }

      // Debug: warn when container is unreasonably large before fit()
      const containerW: number = this.container.offsetWidth;
      const containerH: number = this.container.offsetHeight;
      if (containerW > 10000 || containerH > 10000) {
        console.warn(
          `[TerminalVanilla] OVERSIZED container before fit(): ${containerW}×${containerH}px`,
          {
            terminalId: this.terminalId,
            zoom,
            strategy,
            baseWidth: windowElement?.dataset.baseWidth,
            baseHeight: windowElement?.dataset.baseHeight,
            fontSize: this.term.options.fontSize,
          }
        );
        console.trace('[TerminalVanilla] OVERSIZED container stack trace');
      }

      // Save scroll position before fit (fit changes row count which can reset scroll)
      const scrollOffset: number = getScrollOffset(this.term.buffer.active);

      this.fitAddon.fit();

      // Restore scroll position after fit
      const newBaseY: number = this.term.buffer.active.baseY;
      const targetLine: number = getScrollTargetLine(newBaseY, scrollOffset);
      this.term.scrollToLine(targetLine);
    });
    this.resizeObserver.observe(this.container);

    // Set up interaction-driven strategy switching (pointerdown → dimension-scaling)
    this.zoomEndUnsubscribe = setupTerminalInteractionStrategy(this.container, term, fitAddon);

    // Initialize terminal backend connection
    await this.initTerminal();
  }

  private async initTerminal(): Promise<void> {
    if (!window.electronAPI?.terminal || !this.term) {
      this.term?.writeln('Terminal is only available in Electron mode.');
      this.term?.writeln('Run the app with: npm run electron:dev');
      return;
    }

    const settings: VTSettings | null = await this.settingsPromise;
    this.terminalBackend = settings?.ptyBackend ?? 'node-pty';
    if (this.terminalBackend === 'tmux') {
      await this.initRelayTerminal();
      return;
    }

    await this.initNodePtyTerminal();
  }

  private async initNodePtyTerminal(): Promise<void> {
    const result: { success: boolean; terminalId?: string; error?: string } = await window.electronAPI.terminal.spawn(this.terminalData);

    if (result.success && result.terminalId) {
      this.terminalId = result.terminalId;

      // Sync initial size
      if (this.term) {
        void window.electronAPI.terminal.resize(result.terminalId, this.term.cols, this.term.rows);
      }

      // Handle terminal output
      this.cleanupOnData = window.electronAPI.terminal.onData((id, data) => {
        if (id === result.terminalId && this.term) {
          this.term.write(data);
        }
      });

      // Handle terminal exit
      this.cleanupOnExit = window.electronAPI.terminal.onExit((id, code) => {
        if (id === result.terminalId && this.term) {
          this.term.writeln(`\r\nProcess exited with code ${code}`);
          this.terminalId = null;
        }
      });
    } else {
      this.term?.writeln('Failed to spawn terminal: ' + (result.error ?? 'Unknown error'));
    }
  }

  private async initRelayTerminal(): Promise<void> {
    if (!this.term) return;

    // M1-fix follow-up (Yan finding): the relay endpoint runs `pty.spawn('tmux attach -t {name}')`
    // which fails if the session doesn't exist. The IPC handler under ptyBackend='tmux'
    // calls terminalManager.spawnTmuxBacked() to create the session — so we must trigger
    // IPC spawn here BEFORE the WebSocket attach, otherwise the panel hangs in
    // "tmux reconnecting" forever (Wei + Yan FAILs).
    const spawnResult: { success: boolean; terminalId?: string; error?: string } = await window.electronAPI.terminal.spawn(this.terminalData);
    if (!spawnResult.success) {
      this.term.writeln('Failed to spawn tmux-backed terminal: ' + (spawnResult.error ?? 'Unknown error'));
      return;
    }
    this.terminalId = spawnResult.terminalId ?? this.terminalData.terminalId;
    this.createRelayStatusIndicator();

    const relayPort: number = await window.electronAPI!.main.getMcpPort();
    const encodedTerminalId: string = encodeURIComponent(this.terminalId);
    const url: string = `ws://localhost:${relayPort}/terminals/${encodedTerminalId}/attach`;

    this.relayClient = new TerminalRelayClient({
      url,
      onData: (data: string): void => {
        this.term?.write(data);
      },
      onStatus: (status: RelayConnectionStatus): void => {
        this.setRelayStatus(status);
        if (status === 'connected' && this.term) {
          this.relayClient?.sendResize(this.term.cols, this.term.rows);
        }
      },
    });
    this.relayClient.connect();
  }

  private async writeToBackend(data: string): Promise<void> {
    if (!this.terminalId) return;
    if (this.terminalBackend === 'tmux') {
      this.relayClient?.sendData(data);
      return;
    }
    if (!window.electronAPI?.terminal) return;
    window.electronAPI.terminal.write(this.terminalId, data).catch(err => {
      console.error('Terminal write error:', err);
    });
  }

  private async resizeBackend(cols: number, rows: number): Promise<void> {
    if (!this.terminalId) return;
    if (this.terminalBackend === 'tmux') {
      this.relayClient?.sendResize(cols, rows);
      return;
    }
    if (window.electronAPI?.terminal) {
      void window.electronAPI.terminal.resize(this.terminalId, cols, rows);
    }
  }

  private createRelayStatusIndicator(): void {
    if (this.relayStatusEl) return;
    this.container.classList.add('terminal-relay-container');
    const statusEl: HTMLDivElement = document.createElement('div');
    statusEl.className = 'terminal-relay-status connecting';
    statusEl.textContent = 'tmux connecting';
    this.container.appendChild(statusEl);
    this.relayStatusEl = statusEl;
  }

  private setRelayStatus(status: RelayConnectionStatus): void {
    if (!this.relayStatusEl) return;
    this.relayStatusEl.className = `terminal-relay-status ${status}`;
    this.relayStatusEl.textContent = status === 'connected'
      ? 'tmux connected'
      : status === 'reconnecting'
        ? 'tmux reconnecting'
        : `tmux ${status}`;
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
   * Cleanup and destroy the terminal
   */
  dispose(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Unsubscribe from IPC terminal listeners
    this.cleanupOnData?.();
    this.cleanupOnData = null;
    this.cleanupOnExit?.();
    this.cleanupOnExit = null;
    this.relayClient?.dispose();
    this.relayClient = null;
    this.relayStatusEl?.remove();
    this.relayStatusEl = null;

    // Unsubscribe from zoom-end callbacks
    this.zoomEndUnsubscribe?.();
    this.zoomEndUnsubscribe = null;

    // Kill terminal process
    if (this.terminalBackend === 'node-pty' && this.terminalId && window.electronAPI?.terminal) {
      void window.electronAPI.terminal.kill(this.terminalId);
    }

    // Release WebGL context slot so new terminals can use it
    if (this.hasWebGLContext) {
      activeWebGLContextCount--;
      this.hasWebGLContext = false;
    }

    // Dispose terminal instance
    this.term?.dispose();
  }
}
