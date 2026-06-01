import {describe, expect, it} from 'vitest'
import {getProjectDotVoicetreePath, getVoicetreeHomePath, VOICETREE_HOME_PATH_ENV} from './paths.ts'

describe('VoiceTree paths', () => {
    it('defaults the global home path to ~/.voicetree', () => {
        expect(getVoicetreeHomePath({env: {}, homePath: '/home/aki'})).toBe('/home/aki/.voicetree')
    })

    it('uses VOICETREE_HOME_PATH verbatim when provided', () => {
        expect(getVoicetreeHomePath({
            env: {[VOICETREE_HOME_PATH_ENV]: '/tmp/vt-home'},
            homePath: '/home/aki',
        })).toBe('/tmp/vt-home')
    })

    it('treats blank VOICETREE_HOME_PATH as unset', () => {
        expect(getVoicetreeHomePath({
            env: {[VOICETREE_HOME_PATH_ENV]: '   '},
            homePath: '/home/aki',
        })).toBe('/home/aki/.voicetree')
    })

    it('builds project-local .voicetree paths from the project path', () => {
        expect(getProjectDotVoicetreePath('/repo/project')).toBe('/repo/project/.voicetree')
    })

    it('does not derive project-local runtime files from a write folder path', () => {
        const projectPath: string = '/repo/project'
        const writeFolderPath: string = '/repo/project/voicetree-29-5'

        expect(getProjectDotVoicetreePath(projectPath)).toBe('/repo/project/.voicetree')
        expect(getProjectDotVoicetreePath(projectPath)).not.toBe(`${writeFolderPath}/.voicetree`)
    })
})
