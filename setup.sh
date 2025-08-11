#!/bin/bash

# VoiceTree Setup Script
set -e

# Get the directory where this script is located (VoiceTree root)
VOICETREE_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPOS_DIR="$(dirname "$VOICETREE_ROOT")"

echo "VoiceTree Setup"
echo "==============="

# Get vault path from argument or prompt
VAULT_PATH="$1"
if [ -z "$VAULT_PATH" ]; then
    read -p "Enter your Obsidian vault path: " VAULT_PATH
fi

# Expand tilde in vault path
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

if [ ! -d "$VAULT_PATH" ]; then
    echo "Error: Vault path does not exist: $VAULT_PATH"
    exit 1
fi

# Detect shell RC file
if [ -n "$ZSH_VERSION" ] || [[ "$SHELL" == */zsh ]]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ] || [[ "$SHELL" == */bash ]]; then
    SHELL_RC="$HOME/.bashrc"
elif [[ "$SHELL" == */fish ]]; then
    SHELL_RC="$HOME/.config/fish/config.fish"
else
    echo "Error: Could not detect shell type (zsh, bash, or fish)"
    exit 1
fi

# Create config directory
CONFIG_DIR="$HOME/.config/voicetree"
mkdir -p "$CONFIG_DIR"

# Save configuration
cat > "$CONFIG_DIR/config" << EOF
# VoiceTree Configuration
VOICETREE_ROOT="$VOICETREE_ROOT"
REPOS_DIR="$REPOS_DIR"
OBSIDIAN_VAULT_PATH="$VAULT_PATH"
EOF

# Create the shell integration script
cat > "$CONFIG_DIR/shell_integration.sh" << 'EOF'
# VoiceTree Shell Integration

# Load VoiceTree configuration
if [ -f "$HOME/.config/voicetree/config" ]; then
    source "$HOME/.config/voicetree/config"
fi

# Source Juggl terminal environment if it exists
JUGGL_ENV_LOCATIONS=(
    "$HOME/.obsidian/.juggl_terminal_env"
    "$OBSIDIAN_VAULT_PATH/.obsidian/.juggl_terminal_env"
    ".obsidian/.juggl_terminal_env"
    "../.obsidian/.juggl_terminal_env"
    "../../.obsidian/.juggl_terminal_env"
)

for env_file in "${JUGGL_ENV_LOCATIONS[@]}"; do
    if [[ -f "$env_file" ]]; then
        source "$env_file"
        rm -f "$env_file" 2>/dev/null
        break
    fi
done

# Check if we opened from a .sh file
if [[ -n "$OBSIDIAN_SOURCE_NOTE" ]] && [[ "$OBSIDIAN_SOURCE_NOTE" == *.sh ]]; then
    if [[ -f "$OBSIDIAN_SOURCE_NOTE" ]]; then
        print -z "./$OBSIDIAN_SOURCE_NOTE"
    else
        print -z "./$OBSIDIAN_SOURCE_NOTE"
    fi 
# If an agent was specified in the env file, pre-fill the command line
elif [[ -n "$agent" ]]; then
    cd "$VOICETREE_ROOT/tools/"
    
    if [[ "$agent" == "claude" ]] && [[ -f "./claude.sh" ]]; then
        print -z "./claude.sh"
    elif [[ "$agent" == "gemini" ]] && [[ -f "./gemini.sh" ]]; then
        print -z "./gemini.sh"
    fi
fi
EOF

# Check if already installed
MARKER="# VoiceTree Shell Integration"
if grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
    echo "VoiceTree is already configured in $SHELL_RC"
    echo "Remove the VoiceTree section manually to reinstall"
    exit 0
fi

# Add to shell RC file
cat >> "$SHELL_RC" << EOF

$MARKER
if [ -f "$CONFIG_DIR/shell_integration.sh" ]; then
    source "$CONFIG_DIR/shell_integration.sh"
fi
EOF

echo "✓ Configuration saved to: $CONFIG_DIR/config"
echo "✓ Added VoiceTree integration to $SHELL_RC"
echo ""
echo "Setup complete! Run: source $SHELL_RC"
echo ""
echo "To uninstall: Remove the VoiceTree section from $SHELL_RC and delete $CONFIG_DIR"