import { EventEmitter } from 'events';

export interface TerminalProcess {
  id: string;
  buffer: string[];
  exitCode: number | null;
  active: boolean;
}

export class MockElectronAPI extends EventEmitter {
  private terminals: Map<string, TerminalProcess> = new Map();
  private dataCallbacks: Array<(id: string, data: string) => void> = [];
  private exitCallbacks: Array<(id: string, code: number) => void> = [];

  constructor() {
    super();
  }

  terminal = {
    spawn: async (): Promise<{ success: boolean; terminalId?: string; error?: string }> => {
      const terminalId = `mock-term-${Date.now()}`;
      const terminal: TerminalProcess = {
        id: terminalId,
        buffer: [],
        exitCode: null,
        active: true,
      };

      this.terminals.set(terminalId, terminal);

      // Simulate initial prompt
      setTimeout(() => {
        this.sendData(terminalId, 'mock@terminal:~$ ');
      }, 10);

      return { success: true, terminalId };
    },

    write: async (terminalId: string, data: string): Promise<{ success: boolean; error?: string }> => {
      const terminal = this.terminals.get(terminalId);
      if (!terminal || !terminal.active) {
        return { success: false, error: 'Terminal not found or inactive' };
      }

      terminal.buffer.push(data);

      // Echo the input back (simulating terminal echo)
      this.sendData(terminalId, data);

      // Process commands if we receive a newline
      if (data.includes('\n') || data.includes('\r')) {
        const command = terminal.buffer.join('').trim();
        terminal.buffer = [];

        // Process the command and send response
        setTimeout(() => {
          this.processCommand(terminalId, command);
        }, 10);
      }

      return { success: true };
    },

    resize: async (terminalId: string, cols: number, rows: number): Promise<{ success: boolean; error?: string }> => {
      const terminal = this.terminals.get(terminalId);
      if (!terminal) {
        return { success: false, error: 'Terminal not found' };
      }

      // In a real implementation, this would resize the PTY
      console.log(`Resizing terminal ${terminalId} to ${cols}x${rows}`);
      return { success: true };
    },

    kill: async (terminalId: string): Promise<{ success: boolean; error?: string }> => {
      const terminal = this.terminals.get(terminalId);
      if (!terminal) {
        return { success: false, error: 'Terminal not found' };
      }

      terminal.active = false;
      terminal.exitCode = 0;

      // Trigger exit callback
      this.exitCallbacks.forEach(cb => cb(terminalId, 0));

      this.terminals.delete(terminalId);
      return { success: true };
    },

    onData: (callback: (id: string, data: string) => void) => {
      this.dataCallbacks.push(callback);
    },

    onExit: (callback: (id: string, code: number) => void) => {
      this.exitCallbacks.push(callback);
    }
  };

  private sendData(terminalId: string, data: string) {
    this.dataCallbacks.forEach(cb => cb(terminalId, data));
  }

  private processCommand(terminalId: string, command: string) {
    const cleanCommand = command.replace(/\r?\n/g, '').trim();

    let response = '';

    // Mock command processing
    if (cleanCommand === 'echo "Hello Terminal"') {
      response = 'Hello Terminal\n';
    } else if (cleanCommand === 'pwd') {
      response = '/home/mock/terminal\n';
    } else if (cleanCommand === 'ls') {
      response = 'file1.txt  file2.txt  directory/\n';
    } else if (cleanCommand === 'echo $USER') {
      response = 'mockuser\n';
    } else if (cleanCommand === 'exit') {
      this.terminal.kill(terminalId);
      return;
    } else if (cleanCommand.startsWith('echo ')) {
      // Handle any echo command
      const text = cleanCommand.substring(5);
      response = `${text}\n`;
    } else if (cleanCommand === '') {
      // Empty command, just show prompt
      response = '';
    } else {
      response = `mock: command not found: ${cleanCommand}\n`;
    }

    // Send response
    if (response) {
      this.sendData(terminalId, response);
    }

    // Send next prompt
    this.sendData(terminalId, 'mock@terminal:~$ ');
  }

  // Helper method for tests to simulate backend responses
  simulateOutput(terminalId: string, output: string) {
    this.sendData(terminalId, output);
  }

  // Helper to check terminal state
  getTerminal(terminalId: string): TerminalProcess | undefined {
    return this.terminals.get(terminalId);
  }

  // Cleanup
  cleanup() {
    this.terminals.clear();
    this.dataCallbacks = [];
    this.exitCallbacks = [];
    this.removeAllListeners();
  }
}

// Create a global instance that can be attached to window
export function setupMockElectronAPI(): MockElectronAPI {
  const mockAPI = new MockElectronAPI();
  (window as any).electronAPI = mockAPI;
  return mockAPI;
}