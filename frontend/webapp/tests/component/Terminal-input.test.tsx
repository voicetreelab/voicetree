import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { Terminal } from '@/components/floating-windows/editors/Terminal';
import '@testing-library/jest-dom';

// Mock xterm
jest.mock('@xterm/xterm', () => {
  const mockTerminal = {
    open: jest.fn(),
    write: jest.fn(),
    writeln: jest.fn(),
    onData: jest.fn(),
    dispose: jest.fn(),
  };

  return {
    Terminal: jest.fn(() => mockTerminal),
  };
});

// Mock electron API
const mockElectronAPI = {
  terminal: {
    spawn: jest.fn(),
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
    onData: jest.fn(),
    onExit: jest.fn(),
  },
};

describe('Terminal Component Input Handling', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup window.electronAPI
    (window as any).electronAPI = mockElectronAPI;

    // Setup successful spawn response
    mockElectronAPI.terminal.spawn.mockResolvedValue({
      success: true,
      terminalId: 'test-terminal-123'
    });

    mockElectronAPI.terminal.write.mockResolvedValue({
      success: true
    });
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('should properly handle terminal input after initialization', async () => {
    const { container } = render(<Terminal />);

    // Wait for terminal to be spawned
    await waitFor(() => {
      expect(mockElectronAPI.terminal.spawn).toHaveBeenCalled();
    });

    // Get the mock terminal instance
    const XTermMock = require('@xterm/xterm').Terminal;
    const mockTerminalInstance = XTermMock.mock.results[0].value;

    // Verify onData handler was registered
    expect(mockTerminalInstance.onData).toHaveBeenCalled();

    // Get the onData callback
    const onDataCallback = mockTerminalInstance.onData.mock.calls[0][0];

    // Simulate typing
    onDataCallback('h');
    onDataCallback('e');
    onDataCallback('l');
    onDataCallback('l');
    onDataCallback('o');

    // Verify that write was called with the terminal ID
    await waitFor(() => {
      expect(mockElectronAPI.terminal.write).toHaveBeenCalledWith('test-terminal-123', 'h');
      expect(mockElectronAPI.terminal.write).toHaveBeenCalledWith('test-terminal-123', 'e');
      expect(mockElectronAPI.terminal.write).toHaveBeenCalledWith('test-terminal-123', 'l');
      expect(mockElectronAPI.terminal.write).toHaveBeenCalledWith('test-terminal-123', 'l');
      expect(mockElectronAPI.terminal.write).toHaveBeenCalledWith('test-terminal-123', 'o');
    });
  });

  it('should handle terminal output from backend', async () => {
    const { container } = render(<Terminal />);

    // Wait for terminal to be spawned
    await waitFor(() => {
      expect(mockElectronAPI.terminal.spawn).toHaveBeenCalled();
    });

    // Get the onData listener that was registered
    const onDataListener = mockElectronAPI.terminal.onData.mock.calls[0][0];

    // Get the mock terminal instance
    const XTermMock = require('@xterm/xterm').Terminal;
    const mockTerminalInstance = XTermMock.mock.results[0].value;

    // Simulate backend sending data
    onDataListener('test-terminal-123', 'Hello from backend');

    // Verify terminal displays the output
    expect(mockTerminalInstance.write).toHaveBeenCalledWith('Hello from backend');
  });

  it('should not send data before terminal is initialized', () => {
    // Mock spawn to be slow
    mockElectronAPI.terminal.spawn.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({
        success: true,
        terminalId: 'test-terminal-123'
      }), 100))
    );

    const { container } = render(<Terminal />);

    // Get the mock terminal instance
    const XTermMock = require('@xterm/xterm').Terminal;
    const mockTerminalInstance = XTermMock.mock.results[0].value;

    // Get the onData callback
    const onDataCallback = mockTerminalInstance.onData.mock.calls[0][0];

    // Try to type before spawn completes
    onDataCallback('test');

    // Should not have called write yet
    expect(mockElectronAPI.terminal.write).not.toHaveBeenCalled();
  });

  it('should cleanup terminal on unmount', async () => {
    const { unmount } = render(<Terminal />);

    // Wait for terminal to be spawned
    await waitFor(() => {
      expect(mockElectronAPI.terminal.spawn).toHaveBeenCalled();
    });

    // Unmount the component
    unmount();

    // Verify cleanup was called
    expect(mockElectronAPI.terminal.kill).toHaveBeenCalledWith('test-terminal-123');

    // Get the mock terminal instance
    const XTermMock = require('@xterm/xterm').Terminal;
    const mockTerminalInstance = XTermMock.mock.results[0].value;
    expect(mockTerminalInstance.dispose).toHaveBeenCalled();
  });
});