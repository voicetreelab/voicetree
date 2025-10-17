import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import type { NodeMetadata } from '@/components/floating-windows/types';

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

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      // fontSize: 12, TODO: DO NOT UNCOMMENT THIS
      // fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      // theme: {
      //   background: '#1e1e1e',
      //   foreground: '#cccccc',
      // },
      // Don't set fixed cols/rows - let FitAddon handle it dynamically
      // scrollback: 10000, // Keep scrollback history
      // scrollOnUserInput: false, // Don't force scroll to bottom on user input
    });

    // Create and load FitAddon for automatic resizing
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    // Create and load WebGL addon for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.log('[Terminal] WebGL context lost, falling back to canvas renderer');
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
      console.log('[Terminal] WebGL renderer enabled');
    } catch (e) {
      console.warn('[Terminal] WebGL not supported, using canvas renderer:', e);
    }

    xtermRef.current = term;
    term.open(terminalRef.current);

    // Initial fit to container
    try {
      fitAddon.fit();
      // Store initial size
      if (terminalRef.current) {
        lastSizeRef.current = {
          width: terminalRef.current.offsetWidth,
          height: terminalRef.current.offsetHeight
        };
      }
      // Notify backend of terminal dimensions
      const cols = term.cols;
      const rows = term.rows;
      console.log(`[Terminal] Initial size: ${cols}x${rows}`);
    } catch (e) {
      console.error('[Terminal] Initial fit failed:', e);
    }

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
            // Fit terminal to new container size
            fitAddonRef.current?.fit();

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
      }, 100); // 100ms debounce (standard for ResizeObserver)
    });

    // Observe the terminal container for size changes
    resizeObserver.observe(terminalRef.current);

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

          // Set up data listener
          if (typeof window !== 'undefined' && window.electronAPI?.terminal) {
            window.electronAPI.terminal.onData((id, data) => {
              if (id === result.terminalId) {
                term.write(data);
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

    initTerminal();

    // Handle terminal input - use ref to get current terminalId
    term.onData(data => {
      console.log('Terminal onData:', data, 'terminalId:', terminalIdRef.current);
      if (terminalIdRef.current && typeof window !== 'undefined' && window.electronAPI?.terminal) {
        // Send input to backend
        console.log('Sending to backend:', data);
        window.electronAPI.terminal.write(terminalIdRef.current, data).then(result => {
          console.log('Write result:', result);
        }).catch(err => {
          console.error('Write error:', err);
        });
      } else {
        console.log('No terminalId or electronAPI:', {
          terminalId: terminalIdRef.current,
          hasAPI: typeof window !== 'undefined' && !!window.electronAPI?.terminal
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
      style={{
        height: '100%',
        width: '100%',
        overflow: 'hidden'
      }}
    />
  );
};
