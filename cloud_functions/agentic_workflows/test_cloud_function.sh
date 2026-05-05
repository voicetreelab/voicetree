#!/bin/bash

# Test script for AppendToRelevantNodeAgent Cloud Function
# Usage: ./test_cloud_function.sh

CLOUD_FUNCTION_URL="https://australia-southeast1-vocetree-alpha.cloudfunctions.net/append-agent"

echo "Testing Cloud Function: $CLOUD_FUNCTION_URL"
echo "---"

curl -X POST "$CLOUD_FUNCTION_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "transcript_text": "We need to add an index to the users table.",
    "existing_nodes_formatted": "1. Database Design - Initial database design discussions",
    "transcript_history": ""
  }'

echo ""
echo "---"
echo "Test complete"