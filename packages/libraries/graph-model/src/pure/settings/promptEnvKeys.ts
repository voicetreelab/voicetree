/**
 * `AGENT_PROMPT` is the user-editable composition hook. Every `AGENT_PROMPT_*`
 * sibling is runtime-managed: prompt templates come from ~/.voicetree/prompts,
 * and AGENT_PROMPT_FILE is generated during terminal launch.
 */
export function isReservedAgentPromptEnvKey(key: string): boolean {
    return key.startsWith('AGENT_PROMPT_');
}
