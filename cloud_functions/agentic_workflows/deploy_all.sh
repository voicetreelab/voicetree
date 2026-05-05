#!/bin/bash

# Master deployment script for all three Cloud Functions
# Deploys append, optimizer, and orphan agents to us-central1

set -e

# Configuration
PROJECT_ID="vocetree-alpha"
REGION="us-central1"
RUNTIME="python312"
MEMORY="1GB"
TIMEOUT="300s"
SOURCE_DIR="."

echo "=========================================="
echo "Deploying All Agent Cloud Functions"
echo "=========================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Runtime: $RUNTIME"
echo "=========================================="
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "Error: .env file not found!"
    echo "Please create a .env file with your environment variables"
    exit 1
fi

# Convert .env to YAML format
echo "Converting .env to .env.yaml..."
bash env_to_yaml.sh
echo ""

# Deploy append agent
echo "=========================================="
echo "Deploying: append-agent"
echo "Entry Point: append_agent_handler"
echo "=========================================="

gcloud functions deploy append-agent \
  --gen2 \
  --runtime="$RUNTIME" \
  --region="$REGION" \
  --source="$SOURCE_DIR" \
  --entry-point=append_agent_handler \
  --memory="$MEMORY" \
  --timeout="$TIMEOUT" \
  --trigger-http \
  --allow-unauthenticated \
  --project="$PROJECT_ID" \
  --env-vars-file=.env.yaml

echo ""
echo "Deployment complete for append-agent"
echo ""

# Deploy optimizer agent
echo "=========================================="
echo "Deploying: optimizer-agent"
echo "Entry Point: optimizer_agent_handler"
echo "=========================================="

gcloud functions deploy optimizer-agent \
  --gen2 \
  --runtime="$RUNTIME" \
  --region="$REGION" \
  --source="$SOURCE_DIR" \
  --entry-point=optimizer_agent_handler \
  --memory="$MEMORY" \
  --timeout="$TIMEOUT" \
  --trigger-http \
  --allow-unauthenticated \
  --project="$PROJECT_ID" \
  --env-vars-file=.env.yaml

echo ""
echo "Deployment complete for optimizer-agent"
echo ""

# Deploy orphan agent
echo "=========================================="
echo "Deploying: orphan-agent"
echo "Entry Point: orphan_agent_handler"
echo "=========================================="

gcloud functions deploy orphan-agent \
  --gen2 \
  --runtime="$RUNTIME" \
  --region="$REGION" \
  --source="$SOURCE_DIR" \
  --entry-point=orphan_agent_handler \
  --memory="$MEMORY" \
  --timeout="$TIMEOUT" \
  --trigger-http \
  --allow-unauthenticated \
  --project="$PROJECT_ID" \
  --env-vars-file=.env.yaml

echo ""
echo "Deployment complete for orphan-agent"
echo ""

echo "=========================================="
echo "All Deployments Complete!"
echo "=========================================="
echo ""
echo "Function URLs:"
echo "=========================================="

# Get append agent URL
APPEND_URL=$(gcloud functions describe append-agent \
  --gen2 \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(serviceConfig.uri)")
echo "append-agent: $APPEND_URL"

# Get optimizer agent URL
OPTIMIZER_URL=$(gcloud functions describe optimizer-agent \
  --gen2 \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(serviceConfig.uri)")
echo "optimizer-agent: $OPTIMIZER_URL"

# Get orphan agent URL
ORPHAN_URL=$(gcloud functions describe orphan-agent \
  --gen2 \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(serviceConfig.uri)")
echo "orphan-agent: $ORPHAN_URL"

echo "=========================================="
