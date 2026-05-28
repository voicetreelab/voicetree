import {statSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

const VOICETREE_DIRNAME: string = '.voicetree'
const NOT_DETECTED_MESSAGE: string = 'No vault found. Run inside a vault directory, or pass --vault <path>.'

function hasVoicetreeMarker(candidatePath: string): boolean {
    try {
        return statSync(join(candidatePath, VOICETREE_DIRNAME)).isDirectory()
    } catch {
        return false
    }
}

export class VaultNotDetectedError extends Error {
    constructor(message: string = NOT_DETECTED_MESSAGE) {
        super(message)
        this.name = 'VaultNotDetectedError'
    }
}

// `cwd` is a required input rather than a `process.cwd()` default — the
// transitive-purity gate flags any process.* access inside a function body,
// including default-parameter expressions, so callers thread cwd in
// explicitly from the shell boundary.
export function detectVaultFromCwd(cwd: string): string | null {
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

export function resolveVault({flag, cwd}: {flag?: string; cwd: string}): string {
    if (flag) {
        const resolvedFlag: string = resolve(cwd, flag)
        if (hasVoicetreeMarker(resolvedFlag)) {
            return resolvedFlag
        }

        throw new VaultNotDetectedError(
            `Vault path "${resolvedFlag}" does not contain .voicetree/. Pass --vault <path> pointing at a vault root.`
        )
    }

    const detectedVault: string | null = detectVaultFromCwd(cwd)
    if (detectedVault !== null) {
        return detectedVault
    }

    throw new VaultNotDetectedError()
}
