import {stat} from 'node:fs/promises'

// stat() that yields null instead of throwing when the path is absent. Single
// shared definition: the import-graph scanner and the architecture-drift check
// previously each carried this identical ENOENT-swallowing wrapper.
export async function statOrNull(absPath: string) {
    try {
        return await stat(absPath)
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw cause
    }
}
