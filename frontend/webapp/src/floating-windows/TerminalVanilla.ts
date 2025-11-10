import { Terminal as XTerm } from '@xterm/xterm';
import type { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { NodeMetadata } from '@/floating-windows/types';
import { FloatingWindowFullscreen } from '@/utils/FloatingWindowFullscreen';

export interface TerminalVanillaConfig {
  nodeMetadata?: NodeMetadata;
  container: HTMLElement;
}

/**
 * Minimal vanilla JS terminal wrapper - bare essentials only
 */
export class TerminalVanilla {
  private term: XTerm | null = null;
  private terminalId: string | null = null;
  private fitAddon: FitAddon | null = null;
  private searchAddon: SearchAddon | null = null;
  private container: HTMLElement;
  private nodeMetadata?: NodeMetadata;
  private resizeObserver: ResizeObserver | null = null;
  private resizeTimeout: NodeJS.Timeout | null = null;
  private fullscreen: FloatingWindowFullscreen;

  constructor(config: TerminalVanillaConfig) {
    this.container = config.container;
    this.nodeMetadata = config.nodeMetadata;

    // Setup fullscreen with callback to fit terminal when fullscreen changes
    this.fullscreen = new FloatingWindowFullscreen(config.container, () => {
      if (this.fitAddon) {
        this.fitAddon.fit();
      }
    });

    this.mount();
  }

  private mount() {
    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      scrollback: 1000,
        scrollOnEraseInDisplay : true,
        scrollOnUserInput: true,
        fontSize: 10,
        allowProposedApi: true, // Required for Unicode11Addon
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

    // Load clipboard addon for proper copy/paste handling
    const clipboardAddon = new ClipboardAddon();
    term.loadAddon(clipboardAddon);

    // Load search addon for find-in-terminal functionality
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    this.searchAddon = searchAddon;

    // Load Unicode11 addon for better Unicode support
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    fitAddon.fit();

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

    // Set up ResizeObserver for container resize with 5s debounce
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

  /**
   * Reconstructs a complete logical line from potentially wrapped physical buffer lines.
   *
   * When terminal content exceeds the terminal width, xterm.js wraps it across multiple
   * physical buffer lines. This utility walks backwards from a given line index to find
   * all wrapped segments and reconstructs the original logical line.
   *
   * This is critical for proper scroll calculations and line-based operations in narrow terminals.
   *
   * @param lineIndex The buffer line index to start from
   * @param buffer The terminal buffer (active or alternate)
   * @returns Object containing the complete line data and the starting line index
   */
  private getFullBufferLineAsString(lineIndex: number, buffer: Terminal['buffer']['active']): { lineData: string | undefined; lineIndex: number } {
    let line = buffer.getLine(lineIndex);
    if (!line) {
      return { lineData: undefined, lineIndex };
    }
    let lineData = line.translateToString(true);
    while (lineIndex > 0 && line.isWrapped) {
      line = buffer.getLine(--lineIndex);
      if (!line) {
        break;
      }
      lineData = line.translateToString(false) + lineData;
    }
    return { lineData, lineIndex };
  }

  /**
   * Enter fullscreen mode
   */
  async enterFullscreen() {
    await this.fullscreen.enter();
  }

  /**
   * Exit fullscreen mode
   */
  async exitFullscreen() {
    await this.fullscreen.exit();
  }

  /**
   * Toggle fullscreen mode
   */
  async toggleFullscreen() {
    await this.fullscreen.toggle();
  }

  /**
   * Check if terminal is in fullscreen mode
   */
  isFullscreen(): boolean {
    return this.fullscreen.isFullscreen();
  }

  /**
   * Cleanup and destroy the terminal
   */
  dispose() {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Cleanup fullscreen
    this.fullscreen.dispose();

    // Kill terminal process
    if (this.terminalId && window.electronAPI?.terminal) {
      window.electronAPI.terminal.kill(this.terminalId);
    }

    // Dispose terminal instance
    this.term?.dispose();
  }
}
