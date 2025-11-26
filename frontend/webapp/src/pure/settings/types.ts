export interface VTSettings {
  readonly terminalSpawnPathRelativeToWatchedDirectory: string;
  readonly agentCommand: string;
  readonly shiftEnterSendsOptionEnter: boolean;
}

export const DEFAULT_SETTINGS: VTSettings = {
  terminalSpawnPathRelativeToWatchedDirectory: '../',
  agentCommand: `claude --dangerously-skip-permissions --append-system-prompt-file "$CONTEXT_NODE_PATH" "Read and understand the context you have been given, and then execute the task or instructions detailed by the context or prompt. As you make significant progress (you MUST do this atleast once before you stop), add a progress node to the context graph. When it comes time to do this, read the template + further instructions at $VOICETREE_APP_SUPPORT/tools/prompts/addNode.md"`,
  shiftEnterSendsOptionEnter: true
};
