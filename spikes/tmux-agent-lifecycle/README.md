# tmux Agent Lifecycle Spike

Standalone bash scripts for testing a filesystem-native agent lifecycle through tmux. The scripts default to `PROJECT_DIR=./test-project` and write metadata/log files under `$PROJECT_DIR/.voicetree/terminals/`.

## Setup

Run commands from `spikes/tmux-agent-lifecycle/`:

```bash
tmux -V
chmod +x *.sh
```

Override the test project when needed:

```bash
PROJECT_DIR=/path/to/project ./list-agents.sh
```

## Scripts

### spawn-agent.sh

```bash
./spawn-agent.sh AGENT_NAME [PROMPT]
```

Creates a detached tmux session named `vt-AGENT_NAME`, pipes pane output to `$PROJECT_DIR/.voicetree/terminals/AGENT_NAME.log`, and writes metadata to `$PROJECT_DIR/.voicetree/terminals/AGENT_NAME.json`.

With a prompt, it starts:

```bash
VOICETREE_TERMINAL_ID=AGENT_NAME claude --print PROMPT
```

Without a prompt, it starts an interactive `bash` shell for local lifecycle testing.

### send-message.sh

```bash
./send-message.sh AGENT_NAME MESSAGE
```

Sends `MESSAGE` plus Enter to the `vt-AGENT_NAME` tmux session.

### list-agents.sh

```bash
./list-agents.sh
```

Reads `$PROJECT_DIR/.voicetree/terminals/*.json`, checks each recorded tmux session, and prints a table with metadata status and tmux presence.

### kill-agent.sh

```bash
./kill-agent.sh AGENT_NAME
```

Kills the `vt-AGENT_NAME` tmux session when present and rewrites the metadata status to `exited`.

### read-output.sh

```bash
./read-output.sh AGENT_NAME [N_LINES]
```

Prints the last `N_LINES` lines from `$PROJECT_DIR/.voicetree/terminals/AGENT_NAME.log`. Defaults to 50 lines.
