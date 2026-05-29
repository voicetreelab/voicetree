import {statSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'

const NOT_DETECTED_MESSAGE: string = 'No project found. Run inside a project directory, or pass --project <path>.'

function hasVoicetreeMarker(candidatePath: string): boolean {
    try {
        return statSync(getProjectDotVoicetreePath(candidatePath)).isDirectory()
    } catch {
        return false
    }
}

export class ProjectNotDetectedError extends Error {
    constructor(message: string = NOT_DETECTED_MESSAGE) {
        super(message)
        this.name = 'ProjectNotDetectedError'
    }
}

// `cwd` is a required input rather than a `process.cwd()` default — the
// transitive-purity gate flags any process.* access inside a function body,
// including default-parameter expressions, so callers thread cwd in
// explicitly from the shell boundary.
export function detectProjectFromCwd(cwd: string): string | null {
    let currentPath: string = resolve(cwd)

    for (;;) {
        if (hasVoicetreeMarker(currentPath)) {
            return currentPath
        }

        const parentPath: string = dirname(currentPath)
        if (parentPath === currentPath) {
            return null
        }

        currentPath = parentPath
    }
}

export function resolveProject({flag, cwd}: {flag?: string; cwd: string}): string {
    if (flag) {
        const resolvedFlag: string = resolve(cwd, flag)
        if (hasVoicetreeMarker(resolvedFlag)) {
            return resolvedFlag
        }

        throw new ProjectNotDetectedError(
            `Project path "${resolvedFlag}" does not contain .voicetree/. Pass --project <path> pointing at a project root.`
        )
    }

    const detectedProject: string | null = detectProjectFromCwd(cwd)
    if (detectedProject !== null) {
        return detectedProject
    }

    throw new ProjectNotDetectedError()
}
