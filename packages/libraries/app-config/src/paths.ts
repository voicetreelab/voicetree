import {homedir} from 'node:os'
import {join} from 'node:path'

export const VOICETREE_HOME_PATH_ENV: string = 'VOICETREE_HOME_PATH'
export const VOICETREE_DIRNAME: string = '.voicetree'

export function getVoicetreeHomePath(input: {
    readonly env: NodeJS.ProcessEnv
    readonly homePath: string
}): string {
    return input.env[VOICETREE_HOME_PATH_ENV]?.trim() || join(input.homePath, VOICETREE_DIRNAME)
}

export function resolveVoicetreeHomePath(): string {
    return getVoicetreeHomePath({
        env: process.env,
        homePath: homedir(),
    })
}

export function getProjectDotVoicetreePath(projectPath: string): string {
    return join(projectPath, VOICETREE_DIRNAME)
}
