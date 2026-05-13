import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from './_types.ts'

export const check: CheckDef = {
    id: 'voicetree-mcp-unit',
    name: 'VoiceTree MCP Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/voicetree-mcp run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/voicetree-mcp', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
