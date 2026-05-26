import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'voicetree-mcp-unit',
    name: 'VoiceTree MCP Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/voicetree-mcp run test',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/voicetree-mcp', 'test', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
