import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { NodeMetadata } from '@/components/floating-windows/types';

/**
 * Strips problematic ANSI escape codes that cause screen clearing/flickering.
 *
 * Evidence from stack traces:
 * 1. eraseInDisplay - clears screen and resets viewport
 * 2. Alternate screen buffer - clears buffer from 301 lines to 30 lines
 *
 * Codes stripped:
 * - \x1b[2J: Erase in Display (clears screen)
 * - \x1b[3J: Erase Saved Lines (clears scrollback)
 * - \x1b[H, \x1b[;H, \x1b[1;1H: Cursor Home variants
 * - \x1b[?1049h/l: Alternate screen buffer (save/restore)
 * - \x1b[?1047h/l: Alternate screen mode
 * - \x1b[?47h/l: Save/restore screen
 * - \x1b[r, \x1b[;r: Reset scroll region
 */
function sanitizeTerminalData(data: string | Uint8Array): string | Uint8Array {
  if (typeof data === 'string') {
    // Match all problematic escape sequences
    // eslint-disable-next-line no-control-regex
    const pattern = /\x1b\[([0-3]?J|[0-9;]*[Hr]|\?(?:1049|1047|47|2026)[hl])/g;
    const matches = data.match(pattern);
    // if (matches) {
    //   console.warn('[Terminal] 🧹 Sanitizing escape codes:', matches.map(m => {
    //     const hex = Array.from(m).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    //     return `${m.replace(/\x1b/, 'ESC')} (hex: ${hex})`;
    //   }));
    // }
      if (matches) {
          matches.map(m => {
              const hex = Array.from(m).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
              return `${m.replace(/\x1b/, 'ESC')} (hex: ${hex})`;
          });
      }
    // eslin-disable-next-line no-control-regex
    return data.replace(pattern, '');
  }
  // If it's a Uint8Array, convert to string, sanitize, then convert back
  const str = new TextDecoder().decode(data);
  // eslint-disable-next-line no-control-regex
  const pattern = /\x1b\[([0-3]?J|[0-9;]*[Hr]|\?(?:1049|1047|47)[hl])/g;
  const matches = str.match(pattern);
  if (matches) {
    console.warn('[Terminal] 🧹 Sanitizing escape codes from Uint8Array:', matches.map(m => {
      const hex = Array.from(m).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
      return `${m.replace(/\x1b/, 'ESC')} (hex: ${hex})`;
    }));
  }
  // eslint-disable-next-line no-control-regex
  const sanitized = str.replace(pattern, '');
  return new TextEncoder().encode(sanitized);
}

export interface TerminalVanillaConfig {
  nodeMetadata?: NodeMetadata;
  container: HTMLElement;
}

/**
 * Vanilla JS Terminal wrapper - No React!
 * Creates and manages an xterm.js terminal instance with all the same functionality
 * as the React Terminal component, but without React overhead.
 */
export class TerminalVanilla {
  private term: XTerm | null = null;
  private terminalId: string | null = null;
  private fitAddon: FitAddon | null = null;
  private lastSize = { width: 0, height: 0 };
  private resizeTimeout: NodeJS.Timeout | null = null;
  private mountCount = 0;
  private followOutput = true;
  private container: HTMLElement;
  private nodeMetadata?: NodeMetadata;
  private resizeObserver: ResizeObserver | null = null;
  private bufferTimeout: NodeJS.Timeout | null = null;
  private buffer = '';

  constructor(config: TerminalVanillaConfig) {
    this.container = config.container;
    this.nodeMetadata = config.nodeMetadata;
    this.mount();
  }

  private mount() {
    // Remount detection - should only mount once
    this.mountCount += 1;
    console.log('[TerminalVanilla] 🚀 MOUNTING VANILLA TERMINAL - Mount count:', this.mountCount);
    console.log('[TerminalVanilla] Container:', this.container);
    console.log('[TerminalVanilla] Container is in DOM:', document.body.contains(this.container));
    console.log('[TerminalVanilla] Container dimensions:', {
      width: this.container.offsetWidth,
      height: this.container.offsetHeight,
      clientWidth: this.container.clientWidth,
      clientHeight: this.container.clientHeight
    });

    if (this.mountCount > 1) {
      console.warn('[Terminal] WARNING: Terminal remounted! This may cause scroll issues.');
    }

    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      // smoothScrollDuration: 0,
      scrollback: 1000,
      scrollOnUserInput: true,
      scrollOnEraseInDisplay: false,
      fastScrollModifier: 'shift',
      fastScrollSensitivity: 5,
    });

    // Create and load FitAddon for automatic resizing
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    this.fitAddon = fitAddon;
    this.term = term;

    // Open terminal BEFORE loading WebGL addon
    console.log('[TerminalVanilla] 📺 Opening xterm...');
    term.open(this.container);
    console.log('[TerminalVanilla] ✅ Xterm opened! Element:', term.element);
    console.log('[TerminalVanilla] Xterm element is in DOM:', document.body.contains(term.element));

    // Create and load WebGL addon AFTER term.open()
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.log('[Terminal] WebGL context lost, falling back to canvas renderer');
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
      console.log('[Terminal] WebGL renderer enabled');

      term.refresh(0, term.rows);
      term.resize(term.cols, term.rows);
    } catch (e) {
      console.warn('[Terminal] WebGL not supported, using canvas renderer:', e);
    }

    // Block alternate screen buffer sequences
    const isAltBuffer = (param?: number) =>
      param === 1049 || param === 1047 || param === 47;

    const disposeSetMode = term.parser.registerCsiHandler(
      { prefix: '?', final: 'h' },
      (params) => {
        const paramArray = Array.isArray(params) ? params : (params?.params || []);
        if (paramArray.some(isAltBuffer)) {
          console.log('[Terminal] 🚫 Blocked alt screen ENTER (CSI ?1049h)');
          return true;
        }
        return false;
      }
    );

    const disposeResetMode = term.parser.registerCsiHandler(
      { prefix: '?', final: 'l' },
      (params) => {
        const paramArray = Array.isArray(params) ? params : (params?.params || []);
        if (paramArray.some(isAltBuffer)) {
          console.log('[Terminal] 🚫 Blocked alt screen EXIT (CSI ?1049l)');
          return true;
        }
        return false;
      }
    );

    // Helper: Check if viewport is at bottom
    const atBottom = () => term.buffer.active.baseY === term.buffer.active.viewportY;

    // Diagnostic logging
    let lastPosition = 0;

    // term.onScroll(() => {
    //   const pos = term.buffer.active.viewportY;
    //   const base = term.buffer.active.baseY;
    //   const atBot = atBottom();
    //
    //   if (pos !== lastPosition) {
    //     if (pos < lastPosition - 3) {
    //       const stack = new Error().stack;
    //       console.error('[Terminal] ❌ POSITION RESET from', lastPosition, 'to', pos);
    //       console.error('[Terminal] Diagnostic Info:', {
    //         viewportY: pos,
    //         baseY: base,
    //         bufferHeight: term.buffer.active.length,
    //         viewportRows: term.rows,
    //         viewportCols: term.cols,
    //         terminalElement: {
    //           width: this.container.offsetWidth,
    //           height: this.container.offsetHeight,
    //           clientWidth: this.container.clientWidth,
    //           clientHeight: this.container.clientHeight
    //         },
    //         lastStoredSize: this.lastSize,
    //         followOutput: this.followOutput,
    //         atBottom: atBot,
    //         scrollback: term.options.scrollback,
    //         cursorX: term.buffer.active.cursorX,
    //         cursorY: term.buffer.active.cursorY
    //       });
    //       console.error('[Terminal] Stack trace:', stack);
    //     }
    //     lastPosition = pos;
    //   }
    //
    //   this.followOutput = atBot;
    // });

    // Listen to DOM viewport scroll events
    const setupViewportScrollListener = () => {
      const viewportEl = term.element?.querySelector('.xterm-viewport') as HTMLElement | null;
      if (viewportEl) {
        viewportEl.addEventListener('scroll', () => {
          this.followOutput = atBottom();
          console.log('[Terminal] User scrolled, follow:', this.followOutput);
        });
      }
    };
    setTimeout(setupViewportScrollListener, 100);

    // Initialize terminal backend connection
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        if (this.container) {
          this.lastSize = {
            width: this.container.offsetWidth,
            height: this.container.offsetHeight
          };
        }
        const cols = term.cols;
        const rows = term.rows;
        console.log(`[Terminal] Initial size after fit: ${cols}x${rows}`);

        this.initTerminal();
      } catch (e) {
        console.error('[Terminal] Initial fit failed:', e);
      }
    });

    // Set up ResizeObserver
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this.fitAddon || !this.term) return;

      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }

      this.resizeTimeout = setTimeout(() => {
        const entry = entries[0];
        if (!entry) return;

        const { width, height } = entry.contentRect;

        if (
          Math.abs(width - this.lastSize.width) > 5 ||
          Math.abs(height - this.lastSize.height) > 5
        ) {
          try {
            const beforePos = this.term?.buffer.active.viewportY;
            console.log('[Terminal] Container resized, calling fit(), position before:', beforePos);
            this.fitAddon?.fit();
            const afterPos = this.term?.buffer.active.viewportY;
            console.log('[Terminal] fit() done, position after:', afterPos);

            this.lastSize = { width, height };

            if (this.terminalId && this.term && typeof window !== 'undefined' && window.electronAPI?.terminal) {
              const cols = this.term.cols;
              const rows = this.term.rows;
              console.log(`[Terminal] Resizing backend to ${cols}x${rows}`);
              window.electronAPI.terminal.resize(this.terminalId, cols, rows);
            }
          } catch (e) {
            console.error('[Terminal] Resize fit failed:', e);
          }
        }
      }, 80);
    });

    this.resizeObserver.observe(this.container);

    // Handle terminal input
    term.onData(data => {
      if (this.terminalId && typeof window !== 'undefined' && window.electronAPI?.terminal) {
        window.electronAPI.terminal.write(this.terminalId, data).catch(err => {
          console.error('Terminal write error:', err);
        });
      }
    });

    // Store dispose handlers for cleanup
    (this.term as any)._disposeSetMode = disposeSetMode;
    (this.term as any)._disposeResetMode = disposeResetMode;
  }

  private async initTerminal() {
    if (typeof window !== 'undefined' && window.electronAPI?.terminal && this.term) {
      console.log('[Terminal Component] Spawning with nodeMetadata:', this.nodeMetadata);
      const result = await window.electronAPI.terminal.spawn(this.nodeMetadata);

      if (result.success && result.terminalId) {
        this.terminalId = result.terminalId;

        if (typeof window !== 'undefined' && window.electronAPI?.terminal && this.fitAddon) {
          const cols = this.term.cols;
          const rows = this.term.rows;
          console.log(`[Terminal] Syncing backend size to ${cols}x${rows}`);
          window.electronAPI.terminal.resize(result.terminalId, cols, rows);
        }

        // Set up data listener with buffering
        if (typeof window !== 'undefined' && window.electronAPI?.terminal) {
          window.electronAPI.terminal.onData((id, data) => {
            if (id === result.terminalId && this.term) {
              if (typeof data === 'string' && data.includes('\x1b[2J')) {
                // console.log('[Terminal] Claude is clearing screen. Data sample:',
                  data = data.slice(0, 100).replace(/\x1b/g, 'ESC');
              }

              this.buffer += data;

              if (this.bufferTimeout) clearTimeout(this.bufferTimeout);

              this.bufferTimeout = setTimeout(() => {
                const sanitizedData = sanitizeTerminalData(this.buffer);
                this.term?.write(sanitizedData);
                this.buffer = '';
              }, 10);
            }
          });

          // Set up exit listener
          window.electronAPI.terminal.onExit((id, code) => {
            if (id === result.terminalId && this.term) {
              this.term.writeln(`\r\nProcess exited with code ${code}`);
              this.terminalId = null;
            }
          });
        }
      } else {
        this.term.writeln('Failed to spawn terminal: ' + (result.error || 'Unknown error'));
      }
    } else {
      this.term?.writeln('Terminal is only available in Electron mode.');
      this.term?.writeln('Run the app with: npm run electron:dev');
    }
  }

  /**
   * Cleanup and destroy the terminal
   */
  dispose() {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Dispose CSI handlers
    if (this.term) {
      (this.term as any)._disposeSetMode?.dispose();
      (this.term as any)._disposeResetMode?.dispose();
    }

    // Kill terminal process
    if (this.terminalId && typeof window !== 'undefined' && window.electronAPI?.terminal) {
      window.electronAPI.terminal.kill(this.terminalId);
    }

    // Dispose terminal instance
    this.term?.dispose();
  }
}
