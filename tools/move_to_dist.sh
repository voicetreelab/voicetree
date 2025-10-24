#!/bin/bash

# Copy the tools folder to the VoiceTree application support directory

set -e

SCRIPT_DIR="$HOME/repos/VoiceTree/tools"
DEST_DIR="$HOME/Library/Application Support/voicetree-webapp/tools"

echo "Copying tools folder to application support directory..."
echo "Source: $SCRIPT_DIR"
echo "Destination: $DEST_DIR"

# Create destination directory if it doesn't exist
#mkdir -p "$DEST_DIR"

# Copy all files from tools directory to destination
cp -rf "$SCRIPT_DIR/"* "$DEST_DIR/"

echo "✓ Tools folder successfully copied to $DEST_DIR"
