import path from 'path'
import { getCallbacks } from '@vt/graph-model'

export async function resolveContextWriteFolderPath(fallbackNodeId?: string): Promise<string> {
    const callbackWriteFolderPath: string | null | undefined = await getCallbacks().getWriteFolderPath?.()
    if (callbackWriteFolderPath) {
        return callbackWriteFolderPath
    }

    return fallbackNodeId ? path.dirname(fallbackNodeId) : ''
}
