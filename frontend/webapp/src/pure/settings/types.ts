export interface AgentConfig {
  readonly name: string;
  readonly command: string;
}

export type EnvVarValue = string | readonly string[];

export interface VTSettings {
  readonly terminalSpawnPathRelativeToWatchedDirectory: string;
  readonly agents: readonly AgentConfig[];
  readonly shiftEnterSendsOptionEnter: boolean;
  readonly INJECT_ENV_VARS: Record<string, EnvVarValue>;
  /** Maximum traversal distance when creating context nodes */
  readonly contextNodeMaxDistance: number;
  /** Maximum traversal distance when creating context nodes in Ask mode (from each relevant node) */
  readonly askModeContextDistance: number;
  /** Default input mode for the transcribe panel */
  readonly defaultInputMode: 'add' | 'ask';
}

export const DEFAULT_SETTINGS: VTSettings = {
  terminalSpawnPathRelativeToWatchedDirectory: '/',
  contextNodeMaxDistance: 7,
  askModeContextDistance: 4,
  defaultInputMode: 'add',
  agents: [
    {
      name: 'Claude',
      command: `claude --dangerously-skip-permissions "$AGENT_PROMPT"`,
    },
    {
      name: 'Gemini',
      command: `gemini -y -i "$AGENT_PROMPT"`,
    },
    {
      name: 'Codex',
      command: `codex "$AGENT_PROMPT"`,
    },
      {
          name: 'Rovodev',
          command: `acli rovodev run "$AGENT_PROMPT"`,
      }
  ],
  shiftEnterSendsOptionEnter: true,
  INJECT_ENV_VARS: {
    AGENT_PROMPT: `First analyze the context of your task: <TASK_CONTEXT> $CONTEXT_NODE_CONTENT </TASK_CONTEXT> 
            Briefly explore your directory to gather additional critical context. 
            <HANDLING_AMBIGUITY> If your task has non-trivial ambiguity, stop and ask the user for clarifications. For each clarifying question include your current working assumption. Otherwise, if the task is clear, continue working on it, or developing your task plan until ambiguity does arise.</HANDLING_AMBIGUITY>
            <TASK_NODES_INSTRUCTION> After completing your task, you MUST:
            1. Read $VOICETREE_APP_SUPPORT/tools/prompts/addNode.md
            2. Follow the instructions to create a progress node documenting your work.

            If using a todolist, add 'Create progress node' as the final item. Either way, you MUST create a progress node before reporting completion to the user. </TASK_NODES_INSTRUCTION>`,
    AGENT_NAME: [
      'Aki', 'Ama', 'Amit', 'Amy', 'Anna', 'Ari', 'Ayu', 'Ben', 'Bob', 'Cho',
      'Dae', 'Dan', 'Eli', 'Emi', 'Eva', 'Eve', 'Fei', 'Gia', 'Gus', 'Hana',
      'Ian', 'Iris', 'Ivan', 'Ivy', 'Jay', 'Jin', 'John', 'Jose', 'Juan', 'Jun',
      'Kai', 'Kate', 'Leo', 'Lou', 'Luis', 'Mary', 'Max', 'Meg', 'Mei', 'Mia',
      'Nia', 'Noa', 'Omar', 'Otto', 'Raj', 'Ren', 'Rex', 'Rio', 'Sai', 'Sam',
      'Siti', 'Tao', 'Tara', 'Timi', 'Uma', 'Vic', 'Wei', 'Xan', 'Yan', 'Zoe',
    ],
  },
};
