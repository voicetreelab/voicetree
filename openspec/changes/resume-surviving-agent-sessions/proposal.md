## Why

VoiceTree already shows surviving tmux-backed agents when Electron or the MCP process loses its in-memory registry, but recovery stops at "attach to an existing tmux pane". If the pane is gone while `.voicetree/terminals/*.json` still says the agent was running, the user needs a first-class way to resume the underlying Claude or Codex session instead of losing the agent from the terminal tree.

## What Changes

- Add a resumable-agent recovery path beside the existing surviving-tmux attach path.
- Discover persisted terminal metadata in the current project's `.voicetree/terminals/` directory and classify records as attachable-live-tmux, resumable-dead-tmux, exited, unsupported, or invalid.
- Show resumable Claude and Codex agents in the terminal tree sidebar with a clear Resume action.
- Resume supported agents by launching a new tmux-backed terminal using CLI-native resume commands (`claude --continue ...` or `codex exec resume --last ...`) from the persisted spawn directory and environment.
- Rehydrate the resumed process into the terminal registry using the original terminal id, agent name, parent/child relationship, task/context paths, and display metadata.
- Do not offer resume for terminal metadata that was explicitly marked exited, manually killed, invalid, foreign-vault, unsupported CLI, or already represented by a live registry record.

## Capabilities

### New Capabilities
- `surviving-agent-session-resume`: Discovers persisted non-exited agent records that no longer have a live tmux pane and resumes supported Claude/Codex sessions from the terminal tree sidebar.

### Modified Capabilities
<!-- No accepted baseline specs exist in openspec/specs yet. -->

## Impact

- **Runtime**: extends `@vt/agent-runtime` around terminal metadata reconciliation, CLI detection/resume command construction, tmux-backed spawn/attach, and current-vault scoping.
- **Main/renderer bridge**: adds main-process APIs and renderer store state for resumable agent sessions, likely adjacent to `unclaimed-tmux-session-sync.ts` and `UnclaimedTmuxStore.ts`.
- **UI**: updates `TerminalTreeSidebar` / `SurvivingAgentsSection` to present both attachable live tmux sessions and resumable persisted sessions without mutating the normal terminal tree.
- **Persistence**: reads existing `.voicetree/terminals/*.json`; no new persistence format should be introduced unless the implementation proves the current metadata cannot distinguish exited/manual states robustly.
- **Tests**: adds black-box tests around discovery classification, resume command selection, registry rehydration, sidebar actions, and rejection of unsupported or explicitly exited records.
