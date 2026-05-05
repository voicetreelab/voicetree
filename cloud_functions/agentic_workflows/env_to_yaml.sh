#!/bin/bash

# Script to convert .env file to YAML format for Google Cloud Functions
# Usage: ./env_to_yaml.sh

set -e

ENV_FILE=".env"
YAML_FILE=".env.yaml"

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found in current directory"
    echo "Please create a .env file with your environment variables"
    exit 1
fi

# Create YAML file from .env
echo "Converting $ENV_FILE to $YAML_FILE..."

# Start with empty file
> "$YAML_FILE"

# Read .env file and convert to YAML
while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines and comments
    if [[ -z "$line" ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
        continue
    fi

    # Extract key and value
    if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"

        # Write to YAML file
        echo "$key: '$value'" >> "$YAML_FILE"
    fi
done < "$ENV_FILE"

# Always add PYTHONUNBUFFERED for better logging
if ! grep -q "PYTHONUNBUFFERED:" "$YAML_FILE"; then
    echo "PYTHONUNBUFFERED: '1'" >> "$YAML_FILE"
fi

echo "✅ Created $YAML_FILE"
echo ""
echo "Contents:"
cat "$YAML_FILE"
