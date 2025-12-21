// OTLP HTTP receiver server - handles both protobuf and JSON payloads

import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { parseOTLPMetrics } from './parser';
import { OTLPMetricsRequest, MetricsCallback } from './types';

const DEFAULT_PORT = 4318;
const DEFAULT_HOST = 'localhost';

/**
 * Creates and configures the OTLP receiver server
 */
export function createOTLPServer(
  onMetrics?: MetricsCallback
): FastifyInstance {
  const server = fastify({
    logger: false,
  });

  // Add content type parser for protobuf
  server.addContentTypeParser(
    'application/x-protobuf',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      // For now, we'll try to parse as JSON since most implementations
      // support JSON encoding. Full protobuf parsing would require
      // the actual .proto definition files.
      try {
        const jsonString = body.toString('utf-8');
        const payload = JSON.parse(jsonString);
        done(null, payload);
      } catch (error) {
        // If it's truly binary protobuf, we'd need protobuf.js with schema
        // For this simple implementation, we'll just pass through
        done(error as Error);
      }
    }
  );

  // OTLP metrics endpoint
  server.post(
    '/v1/metrics',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = request.body as OTLPMetricsRequest;

        // Parse the OTLP metrics
        const parsedMetrics = parseOTLPMetrics(payload);

        // Emit metrics via callback if provided
        if (onMetrics) {
          await Promise.resolve(onMetrics(parsedMetrics));
        }

        // Log parsed metrics
        console.log('[OTLP Receiver] Received metrics:', {
          sessionId: parsedMetrics.sessionId,
          tokens: parsedMetrics.tokens,
          costUsd: parsedMetrics.costUsd,
        });

        // Return success response
        reply.code(200).send({
          status: 'success',
          metrics: parsedMetrics,
        });
      } catch (error) {
        console.error('[OTLP Receiver] Error parsing metrics:', error);
        reply.code(400).send({
          status: 'error',
          message: 'Failed to parse OTLP metrics',
        });
      }
    }
  );

  // Health check endpoint
  server.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ status: 'healthy' });
  });

  return server;
}

/**
 * Starts the OTLP receiver server
 */
export async function startServer(
  port: number = DEFAULT_PORT,
  host: string = DEFAULT_HOST,
  onMetrics?: MetricsCallback
): Promise<FastifyInstance> {
  const server = createOTLPServer(onMetrics);

  try {
    await server.listen({ port, host });
    console.log(`[OTLP Receiver] Server listening on ${host}:${port}`);
    console.log(`[OTLP Receiver] Metrics endpoint: POST http://${host}:${port}/v1/metrics`);
    return server;
  } catch (error) {
    console.error('[OTLP Receiver] Failed to start server:', error);
    throw error;
  }
}
