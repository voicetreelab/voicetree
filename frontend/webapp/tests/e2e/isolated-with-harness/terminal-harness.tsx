import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

// Test window interface
interface TestWindow extends Window {
  electronAPI?: {
    terminal: {
      spawn: () => Promise<{ success: boolean; terminalId?: string; error?: string }>;
      write: (terminalId: string, data: string) => Promise<{ success: boolean; error?: string }>;
      resize: (terminalId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
      kill: (terminalId: string) => Promise<{ success: boolean; error?: string }>;
      onData: (callback: (terminalId: string, data: string) => void) => void;
      onExit: (callback: (terminalId: string, code: number) => void) => void;
    };
  };
  _test_terminal?: {
    instance: XTerm | null;
    terminalId: string | null;
    output: string[];
    lastCommand?: string;
    executeCommand: (command: string) => Promise<void>;
    waitForOutput: (pattern: string | RegExp, timeout?: number) => Promise<string>;
  };
}

// Terminal Test Harness Component
export const TerminalTestHarness: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const outputBufferRef = useRef<string[]>([]);
  const [status, setStatus] = useState<string>('Initializing...');

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
      if ((window as TestWindow).electronAPI?.terminal) {
        // Running in Electron
        const result = await (window as TestWindow).electronAPI.terminal.spawn();

        if (result.success && result.terminalId) {
          terminalIdRef.current = result.terminalId;
          setStatus(`Terminal spawned: ${result.terminalId}`);

          // Set up data listener to capture output
          (window as TestWindow).electronAPI.terminal.onData((id, data) => {
            if (id === result.terminalId) {
              term.write(data);
              outputBufferRef.current.push(data);
              console.log('Terminal output:', data);
            }
          });

          // Set up exit listener
          (window as TestWindow).electronAPI.terminal.onExit((id, code) => {
            if (id === result.terminalId) {
              term.writeln(`\r\nProcess exited with code ${code}`);
              setStatus(`Terminal exited with code ${code}`);
              terminalIdRef.current = null;
            }
          });

          // Expose test utilities
          (window as TestWindow)._test_terminal = {
            instance: term,
            terminalId: result.terminalId,
            output: outputBufferRef.current,
            executeCommand: async (command: string) => {
              if (!terminalIdRef.current || !(window as TestWindow).electronAPI?.terminal) {
                throw new Error('Terminal not available');
              }

              console.log('Executing command:', command);
              outputBufferRef.current = []; // Clear output buffer

              // Send command with newline
              await (window as TestWindow).electronAPI.terminal.write(
                terminalIdRef.current,
                command + '\n'
              );

              (window as TestWindow)._test_terminal!.lastCommand = command;
            },
            waitForOutput: (pattern: string | RegExp, timeout = 5000): Promise<string> => {
              return new Promise((resolve, reject) => {
                const startTime = Date.now();

                const checkOutput = () => {
                  const fullOutput = outputBufferRef.current.join('');

                  if (typeof pattern === 'string') {
                    if (fullOutput.includes(pattern)) {
                      resolve(fullOutput);
                      return;
                    }
                  } else if (pattern.test(fullOutput)) {
                    resolve(fullOutput);
                    return;
                  }

                  if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout waiting for pattern: ${pattern}`));
                    return;
                  }

                  setTimeout(checkOutput, 100);
                };

                checkOutput();
              });
            }
          };

          setStatus('Terminal ready for testing');
        } else {
          const errorMsg = 'Failed to spawn terminal: ' + (result.error || 'Unknown error');
          term.writeln(errorMsg);
          setStatus(errorMsg);
        }
      } else {
        // Running in browser - show placeholder
        term.writeln('Terminal is only available in Electron mode.');
        term.writeln('Run the app with: npm run electron:dev');
        setStatus('Terminal not available (browser mode)');
      }
    };

    initTerminal();

    // Handle terminal input
    term.onData(data => {
      if (terminalIdRef.current && (window as TestWindow).electronAPI?.terminal) {
        (window as TestWindow).electronAPI.terminal.write(terminalIdRef.current, data);
      }
    });

    // Cleanup on unmount
    return () => {
      if (terminalIdRef.current && (window as TestWindow).electronAPI?.terminal) {
        (window as TestWindow).electronAPI.terminal.kill(terminalIdRef.current);
      }
      term.dispose();
    };
  }, []);

  return (
    <div style={{ padding: '20px', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <h1>Terminal Test Harness</h1>
      <div id="status" style={{ marginBottom: '10px', color: '#888' }}>
        Status: {status}
      </div>
      <div
        ref={terminalRef}
        id="terminal-container"
        style={{
          flex: 1,
          border: '1px solid #333',
          backgroundColor: '#1e1e1e',
          overflow: 'hidden'
        }}
      />
    </div>
  );
};

// Mount the component
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<TerminalTestHarness />);