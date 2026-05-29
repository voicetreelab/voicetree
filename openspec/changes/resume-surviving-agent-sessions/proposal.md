## Why

VoiceTree already shows surviving tmux-backed agents when Electron or the MCP process loses its in-memory registry, but recovery stops at "attach to an existing tmux pane". If the pane is gone while `.voicetree/terminals/*.json` still says the agent was running, the user needs a first-class way to resume the underlying Claude or Codex session instead of losing the agent from the terminal tree.

## What Changes

- Add a resumable-agent recovery path beside the existing surviving-tmux attach path.
- Discover persisted terminal metadata in the current project's `.voicetree/terminals/` directory and classify records as attachable-live-tmux, resumable-dead-tmux, exited, unsupported, or invalid.
- Resolve Claude/Codex native session ids from their provider-global stores and persist the resolved handle back into the project-local `.voicetree/terminals/<terminalId>.json` record.
- Show resumable Claude and Codex agents in the terminal tree sidebar with a clear Resume action.
- Resume supported agents by launching a new tmux-backed terminal using exact CLI-native resume commands (`claude --resume <session-id>`, `codex resume <thread-id>`, or `codex exec resume <thread-id>`) from the persisted spawn directory and environment.
- Rehydrate the resumed process into the terminal registry using the original terminal id, agent name, parent/child relationship, task/context paths, and display metadata.
- Do not offer resume for terminal metadata that lacks a deterministic native session handle, was explicitly marked exited, manually killed, invalid, foreign-project, unsupported CLI, or already represented by a live registry record.

## Capabilities

### New Capabilities
- `surviving-agent-session-resume`: Discovers persisted non-exited agent records that no longer have a live tmux pane and resumes supported Claude/Codex sessions from the terminal tree sidebar.

### Modified Capabilities
<!-- No accepted baseline specs exist in openspec/specs yet. -->

## Impact

- **Runtime**: extends `@vt/agent-runtime` around terminal metadata reconciliation, CLI detection/resume command construction, tmux-backed spawn/attach, and current-project scoping.
- **Main/renderer bridge**: adds main-process APIs and renderer store state for resumable agent sessions, likely adjacent to `unclaimed-tmux-session-sync.ts` and `UnclaimedTmuxStore.ts`.
- **UI**: updates `TerminalTreeSidebar` / `SurvivingAgentsSection` to present both attachable live tmux sessions and resumable persisted sessions without mutating the normal terminal tree.
- **Persistence**: extends the existing per-agent `.voicetree/terminals/<terminalId>.json` file with recovery metadata; no separate project store is introduced.
- **Tests**: adds black-box tests around discovery classification, resume command selection, registry rehydration, sidebar actions, and rejection of unsupported or explicitly exited records.
