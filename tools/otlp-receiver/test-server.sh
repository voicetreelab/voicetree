#!/bin/bash

# Test script for OTLP receiver

# Send a test OTLP metrics payload
curl -X POST http://localhost:4318/v1/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "resourceMetrics": [{
      "resource": {
        "attributes": [{
          "key": "VOICETREE_SESSION_ID",
          "value": { "stringValue": "test-session-123" }
        }]
      },
      "scopeMetrics": [{
        "metrics": [
          {
            "name": "claude_code.token.usage",
            "sum": {
              "dataPoints": [
                {
                  "attributes": [{ "key": "token_type", "value": { "stringValue": "input" } }],
                  "asInt": 1000
                },
                {
                  "attributes": [{ "key": "token_type", "value": { "stringValue": "output" } }],
                  "asInt": 500
                },
                {
                  "attributes": [{ "key": "token_type", "value": { "stringValue": "cache_read" } }],
                  "asInt": 200
                }
              ]
            }
          },
          {
            "name": "claude_code.cost.usage",
            "sum": {
              "dataPoints": [{ "asDouble": 0.05 }]
            }
          }
        ]
      }]
    }]
  }'

echo ""
echo "Health check:"
curl http://localhost:4318/health
echo ""
