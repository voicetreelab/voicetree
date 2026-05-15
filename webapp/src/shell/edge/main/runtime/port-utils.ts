import net from 'net';

/**
 * Check if a specific port is available
 * @param port - The port number to check
 * @returns Promise that resolves to true if port is available, false otherwise
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server: net.Server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false); // Port in use
      } else {
        resolve(false); // Other error, treat as unavailable
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true); // Port is available
    });

    // Listen on 127.0.0.1 (localhost only) to match stub server binding
    // Test servers bind to localhost for security
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find next available port starting from startPort
 * @param startPort - The port number to start searching from
 * @returns Promise that resolves to the first available port number
 * @throws Error if no available ports found within maxAttempts
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port: number = startPort;
  const maxAttempts: 100 = 100 as const; // Try up to 100 ports

  for (let i: number = 0; i < maxAttempts; i++) {
    const isAvailable: boolean = await isPortAvailable(port);
    if (isAvailable) {
      return port;
    }
    port++;
  }

  throw new Error(`No available ports found from ${startPort} to ${port - 1}`);
}
