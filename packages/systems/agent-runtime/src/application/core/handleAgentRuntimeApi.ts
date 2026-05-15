export function handleAgentRuntimeApi<const Api extends Record<string, unknown>>(
    api: Api,
): { state: Api; commands: []; response: Api } {
    return {state: api, commands: [], response: api}
}
