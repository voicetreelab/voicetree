export interface Settings {
  terminalSpawnPathRelativeToWatchedDirectory: string;
  agentCommand: string;
}

export const DEFAULT_SETTINGS: Settings = {
  terminalSpawnPathRelativeToWatchedDirectory: '../',
  agentCommand: `claude --dangerously-skip-permissions --append-system-prompt-file "$context_node_path" "Read and understand the context you have been given, and then execute the task or instructions detailed by the context or prompt."`
};
