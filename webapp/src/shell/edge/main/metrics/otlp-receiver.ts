// OTLP HTTP receiver embedded in Electron main process
// Uses Node's built-in http module (no Fastify dependency)

import http from 'http';
import { parseOTLPMetrics, type OTLPMetricsRequest } from './otlp-parser';
import { appendTokenMetrics } from './agent-metrics-store';

const OTLP_BASE_PORT: number = 4318;
const OTLP_MAX_PORT_ATTEMPTS: number = 10;
const OTLP_HOST: string = 'localhost';

let server: http.Server | null = null;
let activePort: number | null = null;

async function handleMetricsRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Only accept POST to /v1/metrics
  if (req.method !== 'POST' || req.url !== '/v1/metrics') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on('end', () => {
    void (async (): Promise<void> => {
    try {
      const body: string = Buffer.concat(chunks).toString('utf-8');
      const payload: OTLPMetricsRequest = JSON.parse(body);

      const parsedMetrics: { sessionId: string; tokens: { input: number; output: number; cacheRead: number; cacheWrite?: number }; costUsd: number } = parseOTLPMetrics(payload);

      //console.log('[OTLP Receiver] Received metrics:', {
      //  sessionId: parsedMetrics.sessionId,
      //  tokens: parsedMetrics.tokens,
      //  costUsd: parsedMetrics.costUsd,
      //});

      // Append token metrics to agent_metrics.json
      await appendTokenMetrics({
        sessionId: parsedMetrics.sessionId,
        tokens: {
          input: parsedMetrics.tokens.input,
          output: parsedMetrics.tokens.output,
          cacheRead: parsedMetrics.tokens.cacheRead,
        },
        costUsd: parsedMetrics.costUsd,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        metrics: parsedMetrics,
      }));
    } catch (error) {
      console.error('[OTLP Receiver] Error parsing metrics:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        message: 'Failed to parse OTLP metrics',
      }));
    }
    })();
  });
}

function tryListenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const testServer: http.Server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
      void handleMetricsRequest(req, res);
    });

    testServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        console.error('[OTLP Receiver] Server error:', error);
        resolve(false);
      }
    });

    testServer.listen(port, OTLP_HOST, () => {
      server = testServer;
      activePort = port;
      //console.log(`[OTLP Receiver] Listening on ${OTLP_HOST}:${port}`);
      //console.log(`[OTLP Receiver] Metrics endpoint: POST http://${OTLP_HOST}:${port}/v1/metrics`);
      resolve(true);
    });
  });
}

export async function startOTLPReceiver(): Promise<void> {
  if (server) {
    //console.log('[OTLP Receiver] Server already running');
    return;
  }

  for (let i: number = 0; i < OTLP_MAX_PORT_ATTEMPTS; i++) {
    const port: number = OTLP_BASE_PORT + i;
    const success: boolean = await tryListenOnPort(port);
    if (success) {
      return;
    }
    console.warn(`[OTLP Receiver] Port ${port} already in use, trying ${port + 1}...`);
  }

  console.warn(`[OTLP Receiver] All ports ${OTLP_BASE_PORT}-${OTLP_BASE_PORT + OTLP_MAX_PORT_ATTEMPTS - 1} in use, skipping`);
}

export function stopOTLPReceiver(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    //console.log('[OTLP Receiver] Shutting down server...');
    server.close(() => {
      //console.log('[OTLP Receiver] Server stopped');
      server = null;
      activePort = null;
      resolve();
    });
  });
}

export function getOTLPReceiverPort(): number | null {
  return activePort;
}
