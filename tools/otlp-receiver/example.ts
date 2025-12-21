// Example usage of OTLP receiver with metrics writer

import { startServer } from './src/server';
import { appendTokenMetrics } from './src/metrics-writer';
import { ParsedMetrics } from './src/types';

async function main(): Promise<void> {
  console.log('Starting OTLP receiver example...\n');

  // Start the server with a callback to append metrics
  const server = await startServer(4318, 'localhost', async (metrics: ParsedMetrics) => {
    console.log('\n[Example] Received metrics:');
    console.log(JSON.stringify(metrics, null, 2));

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
      console.log('[Example] Successfully appended to agent_metrics.json');
    } catch (error) {
      console.error('[Example] Failed to append metrics:', error);
    }
  });

  console.log('\nServer is running. Send OTLP metrics to http://localhost:4318/v1/metrics');
  console.log('\nExample curl command:');
  console.log(`
curl -X POST http://localhost:4318/v1/metrics \\
  -H "Content-Type: application/json" \\
  -d '{
    "resourceMetrics": [{
      "resource": {
        "attributes": [{
          "key": "VOICETREE_SESSION_ID",
          "value": {"stringValue": "example-session-123"}
        }]
      },
      "scopeMetrics": [{
        "metrics": [
          {
            "name": "claude_code.token.usage",
            "sum": {
              "dataPoints": [
                {"attributes": [{"key": "token_type", "value": {"stringValue": "input"}}], "asInt": 1500},
                {"attributes": [{"key": "token_type", "value": {"stringValue": "output"}}], "asInt": 750},
                {"attributes": [{"key": "token_type", "value": {"stringValue": "cache_read"}}], "asInt": 300}
              ]
            }
          },
          {
            "name": "claude_code.cost.usage",
            "sum": {
              "dataPoints": [{"attributes": [], "asDouble": 0.075}]
            }
          }
        ]
      }]
    }]
  }'
  `);

  console.log('\nPress Ctrl+C to stop the server\n');

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\n[Example] Shutting down server...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Example] Fatal error:', error);
  process.exit(1);
});
