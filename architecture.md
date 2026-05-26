# VoiceTree Architecture

This diagram is the tier-1 architecture-drift contract for VoiceTree's high-level process topology.

```mermaid
flowchart TD
  filesystem[Local filesystem]
  electronMain[Electron main process]
  electronRenderer[Electron renderer process]
  graphd[vt-graphd daemon]
  tmuxServer[tmux server]
  mcpServer[vt-mcp HTTP server]
  vtCli[vt CLI]
  agentProcesses[Agent processes]

  electronRenderer -->|IPC bridge| electronMain
  electronRenderer -->|WebSocket terminal stream| electronMain
  electronMain -->|HTTP /graph/* and /session/*| graphd
  vtCli -->|HTTP /mcp| mcpServer
  electronMain -->|in-process startMcpServer| mcpServer
  mcpServer -->|GraphBridge calls| graphd
  mcpServer -->|spawn_agent tool| tmuxServer
  electronMain -->|tmux CLI + socket| tmuxServer
  tmuxServer -->|PTY sessions| agentProcesses
  agentProcesses -->|MCP HTTP tools| mcpServer
  graphd -->|read/write/watch vault markdown| filesystem
  tmuxServer -->|pipe-pane terminal logs| filesystem
  electronMain -->|register .mcp.json| filesystem
  vtCli -->|headless graph commands| graphd

  click filesystem "."
  click electronMain "webapp/src/shell/edge/main/runtime/electron/app/main.ts"
  click electronRenderer "webapp/src/shell/UI/App.tsx"
  click graphd "packages/systems/graph-db-server/bin/vt-graphd.ts"
  click tmuxServer "packages/systems/agent-runtime/src/application/terminals/tmux"
  click mcpServer "packages/systems/voicetree-mcp/src/tools/agent-control/mcp-server.ts"
  click vtCli "webapp/bin/vt"
  click agentProcesses "packages/systems/agent-runtime/src/application/spawn"
```
