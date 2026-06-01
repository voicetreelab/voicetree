#!/bin/bash

# Copy the tools and backend modules to both dist/resources and application support directory

set -e

VOICETREE_DIR="$HOME/repos/VoiceTree"
TOOLS_DIR="$VOICETREE_DIR/tools"
BACKEND_DIR="$VOICETREE_DIR/backend"
DIST_DIR="$VOICETREE_DIR/webapp/dist/resources"
VOICETREE_HOME_DIR="$HOME/Library/Application Support/voicetree-webapp"
VOICETREE_HOME_DIR_2="$HOME/Library/Application Support/VoiceTree"

echo "Copying tools and backend modules to both locations..."
echo "Source: $VOICETREE_DIR"

# Copy tools to dist/resources/tools
echo ""
echo "Copying tools to: $DIST_DIR/tools"
mkdir -p "$DIST_DIR/tools"
cp -rf "$TOOLS_DIR/"* "$DIST_DIR/tools/"
echo "✓ Tools copied to $DIST_DIR/tools"

# Copy backend modules to dist/resources/backend
echo ""
echo "Copying backend modules to: $DIST_DIR/backend"
mkdir -p "$DIST_DIR/backend"
cp -rf "$BACKEND_DIR/context_retrieval" "$DIST_DIR/backend/"
cp -rf "$BACKEND_DIR/markdown_tree_manager" "$DIST_DIR/backend/"
cp -f "$BACKEND_DIR/__init__.py" "$DIST_DIR/backend/"
cp -f "$BACKEND_DIR/types.py" "$DIST_DIR/backend/"
cp -f "$BACKEND_DIR/settings.py" "$DIST_DIR/backend/"
cp -f "$BACKEND_DIR/logging_config.py" "$DIST_DIR/backend/"
echo "✓ Backend modules copied to $DIST_DIR/backend"
echo "  - context_retrieval/"
echo "  - markdown_tree_manager/"
echo "  - types.py, settings.py, logging_config.py"

# Copy tools to application support
echo ""
echo "Copying tools to: $VOICETREE_HOME_DIR/tools"
mkdir -p "$VOICETREE_HOME_DIR/tools"
cp -rf "$TOOLS_DIR/"* "$VOICETREE_HOME_DIR/tools/"
echo "✓ Tools copied to $VOICETREE_HOME_DIR/tools"

# Copy backend modules to application support
echo ""
echo "Copying backend modules to: $VOICETREE_HOME_DIR/backend"
mkdir -p "$VOICETREE_HOME_DIR/backend"
cp -rf "$BACKEND_DIR/context_retrieval" "$VOICETREE_HOME_DIR/backend/"
cp -rf "$BACKEND_DIR/markdown_tree_manager" "$VOICETREE_HOME_DIR/backend/"
cp -f "$BACKEND_DIR/__init__.py" "$VOICETREE_HOME_DIR/backend/"
cp -f "$BACKEND_DIR/types.py" "$VOICETREE_HOME_DIR/backend/"
cp -f "$BACKEND_DIR/settings.py" "$VOICETREE_HOME_DIR/backend/"
cp -f "$BACKEND_DIR/logging_config.py" "$VOICETREE_HOME_DIR/backend/"
echo "✓ Backend modules copied to $VOICETREE_HOME_DIR/backend"
echo "  - context_retrieval/"
echo "  - markdown_tree_manager/"
echo "  - types.py, settings.py, logging_config.py"

# Copy tools to VoiceTree application support
echo ""
echo "Copying tools to: $VOICETREE_HOME_DIR_2/tools"
mkdir -p "$VOICETREE_HOME_DIR_2/tools"
cp -rf "$TOOLS_DIR/"* "$VOICETREE_HOME_DIR_2/tools/"
echo "✓ Tools copied to $VOICETREE_HOME_DIR_2/tools"

# Copy backend modules to VoiceTree application support
echo ""
echo "Copying backend modules to: $VOICETREE_HOME_DIR_2/backend"
mkdir -p "$VOICETREE_HOME_DIR_2/backend"
cp -rf "$BACKEND_DIR/context_retrieval" "$VOICETREE_HOME_DIR_2/backend/"
cp -rf "$BACKEND_DIR/markdown_tree_manager" "$VOICETREE_HOME_DIR_2/backend/"
cp -f "$BACKEND_DIR/__init__.py" "$VOICETREE_HOME_DIR_2/backend/"
cp -f "$BACKEND_DIR/types.py" "$VOICETREE_HOME_DIR_2/backend/"
cp -f "$BACKEND_DIR/settings.py" "$VOICETREE_HOME_DIR_2/backend/"
cp -f "$BACKEND_DIR/logging_config.py" "$VOICETREE_HOME_DIR_2/backend/"
echo "✓ Backend modules copied to $VOICETREE_HOME_DIR_2/backend"
echo "  - context_retrieval/"
echo "  - markdown_tree_manager/"
echo "  - types.py, settings.py, logging_config.py"

echo ""
echo "✅ All files copied successfully!"
