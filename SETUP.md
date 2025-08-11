# VoiceTree Setup Guide

## Quick Start

1. Clone VoiceTree into a `repos` directory (can be anywhere):
   ```bash
   mkdir -p ~/repos
   cd ~/repos
   git clone https://github.com/yourusername/VoiceTree.git
   ```

2. Run the setup script:
   ```bash
   cd VoiceTree
   ./setup.sh /path/to/your/obsidian/vault
   # Or just run ./setup.sh and it will prompt for the path
   ```

3. Reload your shell:
   ```bash
   source ~/.zshrc  # or ~/.bashrc for bash users
   ```

## What the Setup Does

The setup script:
- Saves your configuration to `~/.config/voicetree/config`
- Adds VoiceTree integration to your shell RC file
- Sets up automatic Juggl terminal environment detection
- Makes VoiceTree tools available in your PATH

## Configuration

After setup, VoiceTree stores its configuration in:
- `~/.config/voicetree/config` - Main configuration file
- `~/.config/voicetree/shell_integration.sh` - Shell integration script

## Project Structure

VoiceTree expects the following directory structure:
```
repos/
├── VoiceTree/
│   ├── tools/
│   │   ├── claude.sh
│   │   ├── gemini.sh
│   │   └── common_agent_setup.sh
│   └── ...
└── [other projects you want to access]
```

## Uninstalling

To remove VoiceTree shell integration:
1. Remove the VoiceTree section from your shell RC file (`~/.zshrc` or `~/.bashrc`)
2. Delete the config directory: `rm -rf ~/.config/voicetree`

## Manual Setup (Alternative)

If you prefer manual setup, add this to your shell RC file:

```bash
# VoiceTree Configuration
export VOICETREE_ROOT="/path/to/VoiceTree"
export REPOS_DIR="/path/to/repos"
export OBSIDIAN_VAULT_PATH="/path/to/your/vault"

# Source the shell integration
source "$VOICETREE_ROOT/tools/shell_integration.sh"
```

## Troubleshooting

### Command not found
Make sure you've reloaded your shell after setup:
```bash
source ~/.zshrc  # or ~/.bashrc
```

### Vault not found
Verify your vault path is correct:
```bash
cat ~/.config/voicetree/config
```

### Juggl terminal not working
Ensure the Juggl plugin is installed in Obsidian and configured to use terminal commands.