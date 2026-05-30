import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import './terminal-chrome.css'; // Terminal title bar, context badge, active state styles
import type { VTSettings, TerminalScrollStrategy } from '@vt/graph-model/settings';
import { onSettingsChange } from '@/shell/edge/UI-edge/api';
import { isZoomActive } from '@/shell/edge/UI-edge/floating-windows/anchoring/cytoscape-floating-windows';
import { getCyInstance } from '@/shell/edge/UI-edge/state/controllers/cytoscape-state';
import { getTerminalFontSize, getScrollOffset, getScrollTargetLine } from '@vt/graph-model/floating-windows';
import { setupTerminalInteractionStrategy } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalInteractionStrategy';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import type {RelayConnectionStatus} from '@/shell/edge/main/runtime/electron/daemon/terminals/vtTerminalAttachTypes';
import {notifyTerminalOutput} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalActivityPolling';
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types';

// __vtDebug__'s terminal-buffer reader registry. Defined in main.tsx so this
// hook adds no new module exports to the webapp/shell boundary surface; the
// only thing exposed is a runtime window property.
type TerminalBufferDebug = {
  readonly setTerminalBufferReader?: (terminalId: string, reader: () => string) => void;
  readonly clearTerminalBufferReader?: (terminalId: string) => void;
};

function vtTerminalBufferDebug(): TerminalBufferDebug | null {
  if (typeof window === 'undefined') return null;
  const debug = (window as unknown as {__vtDebug__?: TerminalBufferDebug}).__vtDebug__;
  return debug ?? null;
}

// Chromium caps at ~16 WebGL contexts total; stay well under to leave headroom for
// cytoscape minimap, extensions, etc. Terminals beyond this cap use the DOM renderer.
let activeWebGLContextCount: number = 0;
const MAX_WEBGL_CONTEXTS: number = 8;

// Dispose WebGL addon after 10 minutes of no terminal output or user focus,
// reclaiming GPU-side framebuffers and glyph atlas textures (~20-50MB each).
const WEBGL_IDLE_TIMEOUT_MS: number = 10 * 60 * 1000;

// Reads the rendered active-buffer text (viewport + scrollback) for e2e
// introspection via window.__vtDebug__.readTerminalBuffer(id). xterm's WebGL
// renderer paints to canvas, so the DOM has no scrapable textContent — the
// buffer is the source of truth for "what xterm has rendered."
function readActiveBufferText(term: XTerm | null): string {
  if (!term) return '';
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
}

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
  private scrollStrategy: TerminalScrollStrategy = 'app';
  private settingsUnsub: (() => void) | null = null;
  private zoomEndUnsubscribe: (() => void) | null = null;
  private hasWebGLContext: boolean = false;
  private webglAddon: WebglAddon | null = null;
  private webglIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private onVisibilityChange: (() => void) | null = null;
  private relayHandle: string | null = null;
  private relayUnsubscribers: Array<() => void> = [];
  private relayStatusEl: HTMLDivElement | null = null;
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
      this.scrollStrategy = settings?.terminalScrollStrategy ?? 'app';
    });

    // Live-update the scroll strategy so the user can A/B the wheel behaviours
    // from Settings without respawning terminals.
    this.settingsUnsub = onSettingsChange((): void => {
      void window.electronAPI?.main.loadSettings()
        .then((settings: VTSettings) => {
          this.scrollStrategy = settings?.terminalScrollStrategy ?? 'app';
        })
        .catch(() => { /* keep last known strategy */ });
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

    // Wheel routing for agent terminals. tmux always occupies xterm's *alternate*
    // buffer, so `buffer.active.type` is essentially always 'alternate' here — it
    // can't tell us whether the foreground app (claude TUI, codex, ssh) owns the
    // screen. The reliable signal is the app's OWN mouse-tracking state, which
    // xterm exposes as `term.modes.mouseTrackingMode`.
    //
    // The behaviour is user-selectable via the `terminalScrollStrategy` setting so
    // it can be A/B-tested on real agents:
    //   'app'       — app tracks mouse → return true so xterm encodes the wheel as
    //                 an SGR mouse event and the app scrolls its OWN view; else tmux
    //                 copy-mode. (recommended)
    //   'sgr'       — app tracks mouse → inject SGR wheel bytes into the PTY
    //                 directly (same effect, explicit); else tmux copy-mode.
    //   'suppress'  — alt-screen → do nothing (stops wheel-scrolls-into-shell-history).
    //   'copy-mode' — always tmux copy-mode (legacy behaviour, for comparison).
    //
    // On the normal buffer we always return true so xterm's local scrollback works.
    term.attachCustomWheelEventHandler((event: WheelEvent): boolean => {
      if (term.buffer.active.type !== 'alternate') return true;

      const appTracksMouse: boolean = term.modes.mouseTrackingMode !== 'none';
      const lines: number = Math.max(1, Math.round(Math.abs(event.deltaY) / 40));
      const direction: 'up' | 'down' = event.deltaY < 0 ? 'up' : 'down';

      switch (this.scrollStrategy) {
        case 'suppress':
          // Don't let xterm translate wheel→arrows; don't scroll the pre-app
          // tmux scrollback either. Stop the event so it can't fall through.
          event.preventDefault();
          event.stopPropagation();
          return false;

        case 'sgr':
          if (appTracksMouse) {
            this.writeSgrWheel(direction, lines);
            event.preventDefault();
            event.stopPropagation();
            return false;
          }
          this.copyModeScroll(direction, lines);
          event.preventDefault();
          event.stopPropagation();
          return false;

        case 'copy-mode':
          this.copyModeScroll(direction, lines);
          event.preventDefault();
          event.stopPropagation();
          return false;

        case 'app':
        default:
          if (appTracksMouse) {
            // Let xterm encode the wheel as an SGR mouse event → the app scrolls
            // itself. Returning true means xterm handles (and cancels) the event.
            return true;
          }
          this.copyModeScroll(direction, lines);
          event.preventDefault();
          event.stopPropagation();
          return false;
      }
    });

    // Load WebGL2 addon only if under the context limit (Chromium caps at ~16)
    this.attachWebGL();
    this.resetWebGLIdleTimer();

    this.onVisibilityChange = (): void => {
      if (document.hidden) {
        if (this.webglIdleTimer !== null) {
          clearTimeout(this.webglIdleTimer);
          this.webglIdleTimer = null;
        }
        this.detachWebGL();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);

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

      this.resetWebGLIdleTimer();
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
    if (!this.term) {
      return;
    }
    if (!window.electronAPI?.main) {
      this.term.writeln('Terminal is only available in Electron mode.');
      this.term.writeln('Run the app with: npm run electron:dev');
      return;
    }

    await this.initRelayTerminal();
  }

  private async initRelayTerminal(): Promise<void> {
    if (!this.term) return;

    // Post-BF-376: the per-project VTD owns the tmux server and creates the
    // session as part of the spawn family RPCs
    // (`spawnPlainTerminal` / `spawnPlainTerminalWithNode` /
    // `spawnTerminalWithContextNode`). The renderer panel is mounted only
    // after `terminal-registered` has propagated, so the session is
    // already attached on the daemon's tmux server when this WebSocket
    // connects. No lazy spawn from the renderer.
    this.terminalId = this.terminalData.terminalId;
    vtTerminalBufferDebug()?.setTerminalBufferReader?.(this.terminalId, () => readActiveBufferText(this.term));
    this.createRelayStatusIndicator();

    // Main owns the /terminals/:id/attach WebSocket; we receive PTY bytes
    // and status frames over IPC keyed by an opaque handle id (BF-368).
    const activityTerminalId: TerminalId = this.terminalId as TerminalId;
    const handle: string = await window.electronAPI.terminal.attach(this.terminalId);
    this.relayHandle = handle;

    const offData: () => void = window.electronAPI.terminal.onData(handle, (data: string): void => {
      this.term?.write(data);
      notifyTerminalOutput(activityTerminalId);
    });
    const offStatus: () => void = window.electronAPI.terminal.onStatus(handle, (status: RelayConnectionStatus): void => {
      this.setRelayStatus(status);
      if (status === 'connected' && this.term) {
        void window.electronAPI?.terminal.resize(handle, this.term.cols, this.term.rows);
      }
    });
    this.relayUnsubscribers.push(offData, offStatus);
  }

  private writeToBackend(data: string): void {
    if (!this.terminalId || !this.relayHandle) return;
    void window.electronAPI?.terminal.write(this.relayHandle, data);
  }

  private resizeBackend(cols: number, rows: number): void {
    if (!this.terminalId || !this.relayHandle) return;
    void window.electronAPI?.terminal.resize(this.relayHandle, cols, rows);
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

    // 'closed' is the relay's exit signal — the daemon side only sends
    // {type:'exit'} when the tmux session is genuinely gone (agent process
    // exited). Trigger the same close path the traffic-light close button
    // uses so the floating window, WS subscriber, and tmux registry entry
    // all tear down in one shot. Without this the renderer keeps the dead
    // window onscreen and the WS reconnect loop pings forever.
    if (status === 'closed') {
      const windowElement: HTMLElement | null = this.container.closest('.cy-floating-window') as HTMLElement | null;
      windowElement?.dispatchEvent(new CustomEvent('traffic-light-close', {bubbles: true}));
    }
  }


  /**
   * Focus the terminal so it receives keyboard input
   */
  focus(): void {
    this.attachWebGL();
    this.resetWebGLIdleTimer();
    this.term?.focus();
  }

  /**
   * Scroll terminal to the bottom (latest output)
   */
  scrollToBottom(): void {
    this.term?.scrollToBottom();
  }

  private attachWebGL(): void {
    if (!this.term || this.hasWebGLContext || activeWebGLContextCount >= MAX_WEBGL_CONTEXTS) return;
    const addon = new WebglAddon();
    try {
      this.term.loadAddon(addon);
      activeWebGLContextCount++;
      this.hasWebGLContext = true;
      this.webglAddon = addon;
      addon.onContextLoss(() => this.detachWebGL());
    } catch {
      addon.dispose();
    }
  }

  private detachWebGL(): void {
    if (!this.hasWebGLContext || !this.webglAddon) return;
    try {
      this.webglAddon.dispose();
    } finally {
      this.webglAddon = null;
      activeWebGLContextCount--;
      this.hasWebGLContext = false;
    }
  }

  private resetWebGLIdleTimer(): void {
    if (this.webglIdleTimer !== null) {
      clearTimeout(this.webglIdleTimer);
      this.webglIdleTimer = null;
    }
    if (this.hasWebGLContext) {
      this.webglIdleTimer = setTimeout(() => this.detachWebGL(), WEBGL_IDLE_TIMEOUT_MS);
    }
  }

  /**
   * Cleanup and destroy the terminal
   */
  /** Scroll tmux's pane scrollback via the relay's copy-mode RPC (mouse-mode-agnostic). */
  private copyModeScroll(direction: 'up' | 'down', lines: number): void {
    if (this.relayHandle) {
      void window.electronAPI?.terminal.scroll(this.relayHandle, direction, lines);
    }
  }

  /**
   * Inject SGR mouse-wheel events straight into the PTY so a mouse-tracking app
   * (claude TUI, codex, ssh, …) scrolls its own view. SGR button 64 = wheel-up,
   * 65 = wheel-down; `M` = press (wheel has no release). One sequence per line,
   * capped so a big trackpad fling can't flood the app.
   */
  private writeSgrWheel(direction: 'up' | 'down', lines: number): void {
    if (!this.relayHandle) return;
    const button: number = direction === 'up' ? 64 : 65;
    const count: number = Math.min(lines, 10);
    const seq: string = `\x1b[<${button};1;1M`.repeat(count);
    void window.electronAPI?.terminal.write(this.relayHandle, seq);
  }

  dispose(): void {
    if (this.terminalId) {
      vtTerminalBufferDebug()?.clearTerminalBufferReader?.(this.terminalId);
    }

    this.settingsUnsub?.();
    this.settingsUnsub = null;

    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }

    if (this.webglIdleTimer !== null) {
      clearTimeout(this.webglIdleTimer);
      this.webglIdleTimer = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    for (const off of this.relayUnsubscribers) {
      try { off(); } catch { /* best-effort */ }
    }
    this.relayUnsubscribers = [];
    if (this.relayHandle) {
      // Fire-and-forget — the IPC handler is idempotent (BF-368 gotcha:
      // xterm.js can trigger dispose() twice on rapid unmount).
      void window.electronAPI?.terminal.detach(this.relayHandle);
      this.relayHandle = null;
    }
    this.relayStatusEl?.remove();
    this.relayStatusEl = null;

    // Unsubscribe from zoom-end callbacks
    this.zoomEndUnsubscribe?.();
    this.zoomEndUnsubscribe = null;

    // Release WebGL context slot so new terminals can use it
    this.detachWebGL();

    // Dispose terminal instance
    this.term?.dispose();
  }
}
