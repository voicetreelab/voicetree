import net from 'net';

/**
 * Check if a specific port is available
 * @param port - The port number to check
 * @returns Promise that resolves to true if port is available, false otherwise
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

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

    // IMPORTANT: Listen on 0.0.0.0 (all interfaces) to match Python server binding
    // Python uvicorn binds to 0.0.0.0 by default, so we must check the same address
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Find next available port starting from startPort
 * @param startPort - The port number to start searching from
 * @returns Promise that resolves to the first available port number
 * @throws Error if no available ports found within maxAttempts
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxAttempts = 100; // Try up to 100 ports

  for (let i = 0; i < maxAttempts; i++) {
    const isAvailable = await isPortAvailable(port);
    if (isAvailable) {
      return port;
    }
    port++;
  }

  throw new Error(`No available ports found from ${startPort} to ${port - 1}`);
}
