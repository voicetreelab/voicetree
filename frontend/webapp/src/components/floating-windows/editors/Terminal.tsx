import React, { useEffect, useRef } from 'react';
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
    if (matches) {
      console.warn('[Terminal] 🧹 Sanitizing escape codes:', matches.map(m => {
        const hex = Array.from(m).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
        return `${m.replace(/\x1b/, 'ESC')} (hex: ${hex})`;
      }));
    }
    // eslint-disable-next-line no-control-regex
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

interface TerminalProps {
  nodeMetadata?: NodeMetadata;
}

/**
 * Terminal component using xterm.js for terminal emulation.
 */
export const Terminal: React.FC<TerminalProps> = ({ nodeMetadata }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountCountRef = useRef(0);  // Remount detection
  const followOutputRef = useRef(true);  // Track if we should follow output

  useEffect(() => {
    if (!terminalRef.current) return;

    // Remount detection - should only mount once
    mountCountRef.current += 1;
    console.log('[Terminal] Mount count:', mountCountRef.current);
    if (mountCountRef.current > 1) {
      console.warn('[Terminal] WARNING: Terminal remounted! This may cause scroll issues.');
    }

    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      smoothScrollDuration: 0, // Disable smooth scrolling - it conflicts with rapid output
      scrollback: 10000, // Large scrollback buffer to prevent overflow issues
      scrollOnUserInput: false, // FALSE = Don't jump to bottom when typing (was backwards!)
      // CRITICAL: VS Code's solution to prevent viewport resets from CSI J/3J sequences
      // This tells xterm to handle eraseInDisplay intelligently without hard-resetting viewport to 0
      scrollOnEraseInDisplay: true,
      fastScrollModifier: 'shift', // Hold shift for faster scrolling
      fastScrollSensitivity: 5,
      // fontSize: 12, TODO: DO NOT UNCOMMENT THIS
      // fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      // theme: {
      //   background: '#1e1e1e',
      //   foreground: '#cccccc',
      // },
      // Don't set fixed cols/rows - let FitAddon handle it dynamically
    });


    // Create and load FitAddon for automatic resizing
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    xtermRef.current = term;

    // CRITICAL: Open terminal BEFORE loading WebGL addon
    // This fixes the flickering issue - WebGL renderer must initialize after DOM renderer
    // VSCode pattern: term.open() -> loadAddon(webgl) -> refresh dimensions
    term.open(terminalRef.current);

    // Create and load WebGL addon AFTER term.open() for GPU-accelerated rendering
    // This prevents dimension mismatch between DOM and WebGL renderers
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.log('[Terminal] WebGL context lost, falling back to canvas renderer');
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
      console.log('[Terminal] WebGL renderer enabled');

      // Force refresh after WebGL loads to resolve dimension mismatch
      // WebGL renderer has different cell dimensions than DOM renderer
      term.refresh(0, term.rows);
      term.resize(term.cols, term.rows);
    } catch (e) {
      console.warn('[Terminal] WebGL not supported, using canvas renderer:', e);
    }

    // CRITICAL: Block alternate screen buffer sequences that cause viewport resets
    // Claude CLI uses CSI ?1049h/l (and variants) to enter/exit full-screen mode
    // This destroys scrollback and causes position to jump from 301 -> 1
    const isAltBuffer = (param?: number) =>
      param === 1049 || param === 1047 || param === 47;

    // Block entering alternate screen (CSI ? 1049 h)
    const disposeSetMode = term.parser.registerCsiHandler(
      { prefix: '?', final: 'h' },
      (params) => {
        // params might be an array directly, or have a .params property
        const paramArray = Array.isArray(params) ? params : (params?.params || []);
        if (paramArray.some(isAltBuffer)) {
          console.log('[Terminal] 🚫 Blocked alt screen ENTER (CSI ?1049h)');
          return true; // swallow - don't let xterm handle it
        }
        return false; // let other sequences through
      }
    );

    // Block leaving alternate screen (CSI ? 1049 l)
    const disposeResetMode = term.parser.registerCsiHandler(
      { prefix: '?', final: 'l' },
      (params) => {
        const paramArray = Array.isArray(params) ? params : (params?.params || []);
        if (paramArray.some(isAltBuffer)) {
          console.log('[Terminal] 🚫 Blocked alt screen EXIT (CSI ?1049l)');
          return true; // swallow
        }
        return false;
      }
    );

    // Helper: Check if viewport is at bottom
    const atBottom = () => term.buffer.active.baseY === term.buffer.active.viewportY;

    // Diagnostic logging to detect viewport position changes
    let lastPosition = 0;

    term.onScroll(() => {
      const pos = term.buffer.active.viewportY;
      const base = term.buffer.active.baseY;
      const atBot = atBottom();

      // Stack trace when position actually changes
      if (pos !== lastPosition) {
        // Only log when position DECREASES (resets/jumps backwards)
        if (pos < lastPosition-3) {
          const stack = new Error().stack;
          console.error('[Terminal] ❌ POSITION RESET from', lastPosition, 'to', pos);
          console.error('[Terminal] Diagnostic Info:', {
            viewportY: pos,
            baseY: base,
            bufferHeight: term.buffer.active.length,
            viewportRows: term.rows,
            viewportCols: term.cols,
            terminalElement: {
              width: terminalRef.current?.offsetWidth,
              height: terminalRef.current?.offsetHeight,
              clientWidth: terminalRef.current?.clientWidth,
              clientHeight: terminalRef.current?.clientHeight
            },
            lastStoredSize: lastSizeRef.current,
            followOutput: followOutputRef.current,
            atBottom: atBot,
            scrollback: term.options.scrollback,
            cursorX: term.buffer.active.cursorX,
            cursorY: term.buffer.active.cursorY
          });
          console.error('[Terminal] Stack trace:', stack);
        }
        lastPosition = pos;
      }

      // console.log('[Terminal] onScroll! viewportY:', pos, 'baseY:', base, 'atBottom:', atBot, 'Buffer height:', term.buffer.active.length, 'Viewport rows:', term.rows);

      // Update follow state based on user scroll
      followOutputRef.current = atBot;
    });

    // Listen to DOM viewport scroll events (user-initiated)
    const setupViewportScrollListener = () => {
      const viewportEl = term.element?.querySelector('.xterm-viewport') as HTMLElement | null;
      if (viewportEl) {
        viewportEl.addEventListener('scroll', () => {
          followOutputRef.current = atBottom();
          console.log('[Terminal] User scrolled, follow:', followOutputRef.current);
        });
      }
    };
    // Delay setup until element exists
    setTimeout(setupViewportScrollListener, 100);

    // CRITICAL: Use onWriteParsed instead of after every write (Oren's pattern)
    // term.onWriteParsed(() => {
    //   if (followOutputRef.current) {
    //     const beforePos = term.buffer.active.viewportY;
    //     console.log('[Terminal] onWriteParsed: calling scrollToBottom, position before:', beforePos);
    //     term.scrollToBottom();
    //     const afterPos = term.buffer.active.viewportY;
    //     console.log('[Terminal] onWriteParsed: scrollToBottom done, position after:', afterPos);
    //   }
    // });

    // Initialize terminal backend connection
    const initTerminal = async () => {
      if (typeof window !== 'undefined' && window.electronAPI?.terminal) {
        // Running in Electron - pass node metadata to spawn terminal
        console.log('[Terminal Component] Spawning with nodeMetadata:', nodeMetadata);
        const result = await window.electronAPI.terminal.spawn(nodeMetadata);

        if (result.success && result.terminalId) {
          terminalIdRef.current = result.terminalId;  // Store in ref for immediate access

          // Resize backend PTY to match frontend dimensions
          if (typeof window !== 'undefined' && window.electronAPI?.terminal && fitAddonRef.current) {
            const cols = term.cols;
            const rows = term.rows;
            console.log(`[Terminal] Syncing backend size to ${cols}x${rows}`);
            window.electronAPI.terminal.resize(result.terminalId, cols, rows);
          }

          // Set up data listener with buffering to reduce flicker
          if (typeof window !== 'undefined' && window.electronAPI?.terminal) {
            let buffer = '';
            let bufferTimeout: NodeJS.Timeout | null = null;

            window.electronAPI.terminal.onData((id, data) => {
              if (id === result.terminalId) {
                // Check what Claude is actually sending
                if (typeof data === 'string' && data.includes('\x1b[2J')) {
                  console.log('[Terminal] Claude is clearing screen. Data sample:',
                    data.slice(0, 100).replace(/\x1b/g, 'ESC'));
                }

                // Buffer data to reduce flicker from rapid writes
                buffer += data;

                // Clear existing timeout
                if (bufferTimeout) clearTimeout(bufferTimeout);

                // Write buffered data after brief delay (reduces flicker)
                bufferTimeout = setTimeout(() => {
                  const sanitizedData = sanitizeTerminalData(buffer);
                  term.write(sanitizedData);
                  buffer = '';
                }, 10); // 10ms buffer
              }
            });

            // Set up exit listener
            window.electronAPI.terminal.onExit((id, code) => {
              if (id === result.terminalId) {
                term.writeln(`\r\nProcess exited with code ${code}`);
                terminalIdRef.current = null;
              }
            });
          }
        } else {
          term.writeln('Failed to spawn terminal: ' + (result.error || 'Unknown error'));
        }
      } else {
        // Running in browser - show placeholder
        term.writeln('Terminal is only available in Electron mode.');
        term.writeln('Run the app with: npm run electron:dev');
      }
    };

    // Initial fit to container - delay until browser calculates layout
    // Use requestAnimationFrame to ensure container has final dimensions
    // IMPORTANT: Initialize backend AFTER fitting to avoid spawning with wrong size
    // The floating window is now sized properly (920x550) to accommodate 100+ columns
    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        // Store initial size
        if (terminalRef.current) {
          lastSizeRef.current = {
            width: terminalRef.current.offsetWidth,
            height: terminalRef.current.offsetHeight
          };
        }
        // Log terminal dimensions
        const cols = term.cols;
        const rows = term.rows;
        console.log(`[Terminal] Initial size after fit: ${cols}x${rows}`);

        // Now spawn backend terminal with correct dimensions
        initTerminal();
      } catch (e) {
        console.error('[Terminal] Initial fit failed:', e);
      }
    });

    // Set up ResizeObserver to handle window resizing
    // Standard pattern: debounce + size change detection to avoid excessive fit() calls
    const resizeObserver = new ResizeObserver((entries) => {
      if (!fitAddonRef.current || !xtermRef.current) return;

      // Clear any pending resize timeout (debouncing)
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      // Debounce resize to avoid excessive fit() calls during rapid resizing
      resizeTimeoutRef.current = setTimeout(() => {
        const entry = entries[0];
        if (!entry) return;

        const { width, height } = entry.contentRect;

        // Only fit if size actually changed (avoid triggering on every DOM update)
        if (
          Math.abs(width - lastSizeRef.current.width) > 5 ||
          Math.abs(height - lastSizeRef.current.height) > 5
        ) {
          try {
            const beforePos = xtermRef.current?.buffer.active.viewportY;
            console.log('[Terminal] Container resized, calling fit(), position before:', beforePos);
            // Fit terminal to new container size
            fitAddonRef.current?.fit();
            const afterPos = xtermRef.current?.buffer.active.viewportY;
            console.log('[Terminal] fit() done, position after:', afterPos);

            // Update stored size
            lastSizeRef.current = { width, height };

            // Notify backend of new dimensions
            if (terminalIdRef.current && xtermRef.current && typeof window !== 'undefined' && window.electronAPI?.terminal) {
              const cols = xtermRef.current.cols;
              const rows = xtermRef.current.rows;
              console.log(`[Terminal] Resizing backend to ${cols}x${rows}`);
              window.electronAPI.terminal.resize(terminalIdRef.current, cols, rows);
            }
          } catch (e) {
            console.error('[Terminal] Resize fit failed:', e);
          }
        }
      }, 80); // 80ms debounce (Oren's recommendation)
    });

    // Observe the terminal container for size changes
    resizeObserver.observe(terminalRef.current);

    // Handle terminal input - use ref to get current terminalId
    term.onData(data => {
      if (terminalIdRef.current && typeof window !== 'undefined' && window.electronAPI?.terminal) {
        window.electronAPI.terminal.write(terminalIdRef.current, data).catch(err => {
          console.error('Terminal write error:', err);
        });
      }
    });

    // Cleanup on unmount
    return () => {
      // Clear any pending resize timeout
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      // Disconnect resize observer
      resizeObserver.disconnect();

      // Dispose CSI handlers
      disposeSetMode.dispose();
      disposeResetMode.dispose();

      // Kill terminal process
      if (terminalIdRef.current && typeof window !== 'undefined' && window.electronAPI?.terminal) {
        window.electronAPI.terminal.kill(terminalIdRef.current);
      }

      // Dispose terminal instance
      term.dispose();
    };
  }, [nodeMetadata]);

  return (
    <div
      ref={terminalRef}
      className="fw-terminal"
      style={{
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        // CRITICAL: Oren's CSS fix - kill browser scroll anchoring
        overflowAnchor: 'none',
        overscrollBehavior: 'contain'
      }}
    />
  );
};
