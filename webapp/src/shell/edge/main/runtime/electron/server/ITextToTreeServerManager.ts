/**
 * Interface for TextToTreeServer management.
 *
 * TextToTreeServer: Converts text input (voice or typed) into a markdown tree structure
 * and keeps a specified folder synchronized with the generated nodes.
 *
 * Note: This server is NOT responsible for reading existing markdown files.
 * File watching and graph visualization of existing files happens independently
 * in FileWatchHandler and the frontend renderer.
 *
 * Implementations:
 * - StubTextToTreeServerManager: Lightweight HTTP server for e2e-tests
 * - RealTextToTreeServerManager: Python backend process manager
 */
export interface ITextToTreeServerManager {
  /**
   * Start the TextToTreeServer and return the port it's running on
   * @returns Promise that resolves to the port number
   * @throws Error if server fails to start within timeout
   */
  start(): Promise<number>;

  /**
   * Stop the TextToTreeServer and clean up resources
   */
  stop(): void;

  /**
   * Check if the TextToTreeServer is currently running
   * @returns true if server is running, false otherwise
   */
  isRunning(): boolean;

  /**
   * Get the port the TextToTreeServer is running on
   * @returns port number or null if not running
   */
  getPort(): number | null;
}
