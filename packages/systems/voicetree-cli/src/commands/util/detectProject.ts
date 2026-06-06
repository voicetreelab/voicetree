import {resolve} from 'node:path'
import {detectProjectFromCwd, hasVoicetreeMarker, resolveProjectRoot} from '@vt/paths'

const NOT_DETECTED_MESSAGE: string = 'No project found. Run inside a project directory, or pass --project <path>.'

// Re-exported so existing CLI call sites keep importing project resolution from
// this module. The walk-up itself now lives in `@vt/paths` as the single shared
// implementation used by both the graphd (CLI) and rpc (vt-rpc) resolvers, so
// the two can never drift apart again.
export {detectProjectFromCwd}

export class ProjectNotDetectedError extends Error {
    constructor(message: string = NOT_DETECTED_MESSAGE) {
        super(message)
        this.name = 'ProjectNotDetectedError'
    }
}

// Resolve the project root for a CLI command. Precedence:
//   1. explicit `--project <path>` flag (must be a valid project root)
//   2. `$VOICETREE_PROJECT_PATH` when set and a valid project root
//   3. CWD up-walk
//
// `cwd` and `env` are required inputs rather than `process.*` defaults — the
// transitive-purity gate flags any `process.*` access inside a function body
// (including default-parameter expressions), so callers thread the shell values
// in explicitly from the boundary.
export function resolveProject({flag, cwd, env}: {
    flag?: string
    cwd: string
    env: Record<string, string | undefined>
}): string {
    if (flag) {
        const resolvedFlag: string = resolve(cwd, flag)
        if (hasVoicetreeMarker(resolvedFlag)) {
            return resolvedFlag
        }

        throw new ProjectNotDetectedError(
            `Project path "${resolvedFlag}" does not contain .voicetree/. Pass --project <path> pointing at a project root.`
        )
    }

    const detectedProject: string | null = resolveProjectRoot({cwd, env})
    if (detectedProject !== null) {
        return detectedProject
    }

    throw new ProjectNotDetectedError()
}
