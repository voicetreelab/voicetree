/**
 * EXPERIMENTAL: Terminal with user-scroll-only mode
 *
 * This variant blocks programmatic scrolls and only allows scrolling
 * from actual user mouse wheel/trackpad events.
 *
 * Purpose: Test if blocking non-user scrolls fixes the scrolling bug
 */

import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { NodeMetadata } from '@/floating-windows/types.ts';

export interface TerminalNoAutoScrollConfig {
  nodeMetadata?: NodeMetadata;
  container: HTMLElement;
}

export class TerminalNoAutoScroll {
  private term: XTerm | null = null;
  private terminalId: string | null = null;
  private fitAddon: FitAddon | null = null;
  private container: HTMLElement;
  private nodeMetadata?: NodeMetadata;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimeout: NodeJS.Timeout | null = null;

  // User scroll tracking
  private userScrollFlag = false;
  private lastScrollPosition = 0;

  constructor(config: TerminalNoAutoScrollConfig) {
    this.container = config.container;
    this.nodeMetadata = config.nodeMetadata;
    this.mount();
  }

  private mount() {
    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      scrollback: 1000,
      scrollOnUserInput: false, // Don't auto-scroll on user input
    });

    // Add FitAddon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    this.fitAddon = fitAddon;
    this.term = term;

    // Open terminal in the DOM
    term.open(this.container);

    // Load WebGL2 addon for better rendering performance
    try {
      const webglAddon = new WebglAddon();
      term.loadAddon(webglAddon);
      webglAddon.onContextLoss(() => {
        console.warn('WebGL context lost, terminal will fall back to DOM renderer');
        webglAddon.dispose();
      });
    } catch (e) {
      console.warn('WebGL2 not supported, using default DOM renderer:', e);
    }

    fitAddon.fit();

    // **EXPERIMENTAL: Track user wheel events with flag approach**
    const wheelHandler = (e: WheelEvent) => {
      console.log('[NoAutoScroll] 🖱️ WHEEL EVENT, deltaY:', e.deltaY);
      this.userScrollFlag = true;
      setTimeout(() => {
        console.log('[NoAutoScroll] ⏰ Clearing user scroll flag');
        this.userScrollFlag = false;
      }, 50);
    };

    // Try multiple event listeners to catch it early
    term.element?.addEventListener('wheel', wheelHandler, { passive: true, capture: true });
    this.container.addEventListener('wheel', wheelHandler, { passive: true, capture: true });
    console.log('[NoAutoScroll] Wheel listeners attached to:', term.element, this.container);

    // **EXPERIMENTAL: Monitor scrolls and block non-user scrolls**
    term.onScroll((newPosition) => {
      const delta = newPosition - this.lastScrollPosition;
      const isUserInitiated = this.userScrollFlag;

      console.log('[NoAutoScroll] 📜 SCROLL EVENT:', {
        newPosition,
        lastPosition: this.lastScrollPosition,
        delta,
        userScrollFlag: this.userScrollFlag,
        isUserInitiated,
        willBlock: !isUserInitiated && newPosition !== this.lastScrollPosition
      });

      if (!isUserInitiated && newPosition !== this.lastScrollPosition) {
        // This scroll happened WITHOUT the user scroll flag - block it!
        console.error('[NoAutoScroll] ❌ BLOCKING programmatic scroll from', this.lastScrollPosition, 'to', newPosition);

        // Immediately scroll back to previous position
        term.scrollToLine(this.lastScrollPosition);
        return;
      }

      // Allow this scroll - update tracked position
      console.log('[NoAutoScroll] ✅ ALLOWING scroll to', newPosition);
      this.lastScrollPosition = newPosition;
    });

    // Handle terminal input
    term.onData(data => {
      if (this.terminalId && window.electronAPI?.terminal) {
        window.electronAPI.terminal.write(this.terminalId, data).catch(err => {
          console.error('Terminal write error:', err);
        });
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      if (this.terminalId && window.electronAPI?.terminal) {
        window.electronAPI.terminal.resize(this.terminalId, cols, rows);
      }
    });

    // Set up ResizeObserver for container resize
    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      this.resizeTimeout = setTimeout(() => {
        if (this.fitAddon) {
          this.fitAddon.fit();
        }
      }, 300);
    });
    this.resizeObserver.observe(this.container);

    // Initialize terminal backend connection
    this.initTerminal();
  }

  private async initTerminal() {
    if (!window.electronAPI?.terminal || !this.term) {
      this.term?.writeln('Terminal is only available in Electron mode.');
      this.term?.writeln('Run the app with: npm run electron:dev');
      return;
    }

    const result = await window.electronAPI.terminal.spawn(this.nodeMetadata);

    if (result.success && result.terminalId) {
      this.terminalId = result.terminalId;

      // Sync initial size
      if (this.term) {
        window.electronAPI.terminal.resize(result.terminalId, this.term.cols, this.term.rows);
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
      this.term?.writeln('Failed to spawn terminal: ' + (result.error || 'Unknown error'));
    }
  }

  dispose() {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Kill terminal process
    if (this.terminalId && window.electronAPI?.terminal) {
      window.electronAPI.terminal.kill(this.terminalId);
    }

    // Dispose terminal instance
    this.term?.dispose();
  }
}
