import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { findAvailablePort, isPortAvailable } from '../../../src/electron/port-utils';

describe('Port Discovery Utilities', () => {
  let testServers: net.Server[] = [];

  afterEach(async () => {
    // Clean up any test servers
    for (const server of testServers) {
      await new Promise<void>((resolve) => {
        if (server.listening) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    }
    testServers = [];
  });

  describe('isPortAvailable', () => {
    it('should return true for an available port', async () => {
      // Port 9999 is very unlikely to be in use
      const result = await isPortAvailable(9999);
      expect(result).toBe(true);
    });

    it('should return false for a port in use', async () => {
      // Start a server on a port binding to 0.0.0.0 (all interfaces)
      // This matches how Python uvicorn binds by default
      const server = net.createServer();
      await new Promise<void>((resolve) => {
        server.listen(9998, '0.0.0.0', () => resolve());
      });
      testServers.push(server);

      // Check that the port is reported as unavailable
      const result = await isPortAvailable(9998);
      expect(result).toBe(false);
    });
  });

  describe('findAvailablePort', () => {
    it('should find the first available port when starting port is available', async () => {
      const port = await findAvailablePort(9990);
      expect(port).toBe(9990);
    });

    it('should skip occupied ports and find the next available one', async () => {
      // Occupy ports 9980, 9981, 9982 on all interfaces (0.0.0.0)
      for (let i = 0; i < 3; i++) {
        const server = net.createServer();
        await new Promise<void>((resolve) => {
          server.listen(9980 + i, '0.0.0.0', () => resolve());
        });
        testServers.push(server);
      }

      // Should find 9983 (first available after occupied ones)
      const port = await findAvailablePort(9980);
      expect(port).toBe(9983);
    });

    it('should throw an error when no available ports found within max attempts', async () => {
      // Occupy a range of ports to trigger the max attempts error
      // We'll occupy 101 ports to ensure we exceed maxAttempts (100)
      const startPort = 9900;
      const occupyCount = 101;

      for (let i = 0; i < occupyCount; i++) {
        const server = net.createServer();
        await new Promise<void>((resolve) => {
          server.listen(startPort + i, '0.0.0.0', () => resolve());
        });
        testServers.push(server);
      }

      // Should throw error because all 100 attempts fail
      await expect(findAvailablePort(startPort)).rejects.toThrow(/No available ports found from 9900 to 9999/);
    }, 30000); // Longer timeout for this test since we're creating many servers
  });
});
