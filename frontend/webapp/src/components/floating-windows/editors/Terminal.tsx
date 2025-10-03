import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
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

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
      },
      cols: 80,
      rows: 24,
    });

    xtermRef.current = term;
    term.open(terminalRef.current);

    // Initialize terminal backend connection
    const initTerminal = async () => {
      if (typeof window !== 'undefined' && window.electronAPI?.terminal) {
        // Running in Electron - pass node metadata to spawn terminal
        console.log('[Terminal Component] Spawning with nodeMetadata:', nodeMetadata);
        const result = await window.electronAPI.terminal.spawn(nodeMetadata);

        if (result.success && result.terminalId) {
          terminalIdRef.current = result.terminalId;  // Store in ref for immediate access

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
      if (terminalIdRef.current && typeof window !== 'undefined' && window.electronAPI?.terminal) {
        window.electronAPI.terminal.kill(terminalIdRef.current);
      }
      term.dispose();
    };
  }, []);

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
