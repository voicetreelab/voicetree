import http from 'http';
import { findAvailablePort } from '@/shell/edge/main/electron/port-utils.ts';
import type { ITextToTreeServerManager } from './ITextToTreeServerManager.ts';

/**
 * Lightweight stub TextToTreeServer for testing.
 * Provides minimal /health and /load-directory endpoints.
 * Does NOT actually parse markdown or convert text to trees.
 */
export class StubTextToTreeServerManager implements ITextToTreeServerManager {
  private stubServer: http.Server | null = null;
  private actualPort: number | null = null;

  async start(): Promise<number> {
    const port = await findAvailablePort(8001);
    this.actualPort = port;

    console.log(`[StubTextToTreeServer] Starting on port ${port}...`);

    const server = http.createServer((req, res) => {
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';

      if (method === 'GET' && url.startsWith('/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: 'Stub backend healthy' }));
        return;
      }

      if (method === 'POST' && url.startsWith('/load-directory')) {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });

        req.on('end', () => {
          let directoryPath = 'unknown';
          try {
            const parsed = JSON.parse(body);
            directoryPath = parsed.directory_path ?? directoryPath;
          } catch {
            console.log('[StubTextToTreeServer] Failed to parse load-directory payload');
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'success',
            message: 'Stub server: directory loaded',
            directory: directoryPath,
            nodes_loaded: 0
          }));
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Stub server: endpoint not implemented' }));
    });

    // Start server with timeout
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('[StubTextToTreeServer] Timeout: server.listen() took > 5 seconds'));
      }, 5000);

      server.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });

      server.listen(port, '127.0.0.1', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.stubServer = server;
    console.log(`[StubTextToTreeServer] Listening on 127.0.0.1:${port}`);
    return port;
  }

  stop(): void {
    if (this.stubServer) {
      console.log('[StubTextToTreeServer] Shutting down...');
      try {
        this.stubServer.close();
      } catch (error) {
        console.error('[StubTextToTreeServer] Error stopping:', error);
      }
      this.stubServer = null;
      this.actualPort = null;
    }
  }

  isRunning(): boolean {
    return this.stubServer !== null;
  }

  getPort(): number | null {
    return this.actualPort;
  }
}
