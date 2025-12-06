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
}

export const DEFAULT_SETTINGS: VTSettings = {
  terminalSpawnPathRelativeToWatchedDirectory: '/',
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
            <TASK_NODES_INSTRUCTION> As you make substantial progress against your task, add progress node(s) to the context graph. Only when it comes time to do this, read the template + further instructions at $VOICETREE_APP_SUPPORT/tools/prompts/addNode.md do not read this yet (so you don't pollute your context), but remember to do so by adding to your todolist. </TASK_NODES_INSTRUCTION>`,
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
