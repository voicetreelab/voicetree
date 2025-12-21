// Entry point for OTLP receiver

import { startServer } from './server';
import { ParsedMetrics } from './types';
import { appendTokenMetrics } from './metrics-writer';

// Export types and functions for library usage
export { createOTLPServer, startServer } from './server';
export { parseOTLPMetrics } from './parser';
export { appendTokenMetrics } from './metrics-writer';
export * from './types';

// Main function for standalone execution
async function main(): Promise<void> {
  const port = process.env.OTLP_PORT
    ? parseInt(process.env.OTLP_PORT, 10)
    : 4318;
  const host = process.env.OTLP_HOST || 'localhost';

  // Callback to handle parsed metrics
  const handleMetrics = async (metrics: ParsedMetrics): Promise<void> => {
    console.log('[Main] Parsed metrics:', JSON.stringify(metrics, null, 2));

    // Append token and cost metrics to agent_metrics.json
    try {
      await appendTokenMetrics({
        sessionId: metrics.sessionId,
        tokens: {
          input: metrics.tokens.input,
          output: metrics.tokens.output,
          cacheRead: metrics.tokens.cacheRead,
        },
        costUsd: metrics.costUsd,
      });
      console.log('[Main] Successfully appended metrics to agent_metrics.json');
    } catch (error) {
      console.error('[Main] Failed to append metrics:', error);
    }
  };

  const server = await startServer(port, host, handleMetrics);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('[Main] Shutting down server...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('[Main] Fatal error:', error);
    process.exit(1);
  });
}
