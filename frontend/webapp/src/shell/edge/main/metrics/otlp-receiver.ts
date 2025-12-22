// OTLP HTTP receiver embedded in Electron main process
// Uses Node's built-in http module (no Fastify dependency)

import http from 'http';
import { parseOTLPMetrics, type OTLPMetricsRequest } from './otlp-parser';
import { appendTokenMetrics } from './agent-metrics-store';

const OTLP_PORT = 4318;
const OTLP_HOST = 'localhost';

let server: http.Server | null = null;

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

  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks).toString('utf-8');
      const payload: OTLPMetricsRequest = JSON.parse(body);

      const parsedMetrics = parseOTLPMetrics(payload);

      console.log('[OTLP Receiver] Received metrics:', {
        sessionId: parsedMetrics.sessionId,
        tokens: parsedMetrics.tokens,
        costUsd: parsedMetrics.costUsd,
      });

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
  });
}

export function startOTLPReceiver(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      console.log('[OTLP Receiver] Server already running');
      resolve();
      return;
    }

    server = http.createServer((req, res) => {
      void handleMetricsRequest(req, res);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(`[OTLP Receiver] Port ${OTLP_PORT} already in use, skipping`);
        server = null;
        resolve(); // Don't fail if port is busy
      } else {
        console.error('[OTLP Receiver] Server error:', error);
        reject(error);
      }
    });

    server.listen(OTLP_PORT, OTLP_HOST, () => {
      console.log(`[OTLP Receiver] Listening on ${OTLP_HOST}:${OTLP_PORT}`);
      console.log(`[OTLP Receiver] Metrics endpoint: POST http://${OTLP_HOST}:${OTLP_PORT}/v1/metrics`);
      resolve();
    });
  });
}

export function stopOTLPReceiver(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    console.log('[OTLP Receiver] Shutting down server...');
    server.close(() => {
      console.log('[OTLP Receiver] Server stopped');
      server = null;
      resolve();
    });
  });
}
