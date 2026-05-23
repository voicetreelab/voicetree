import path from 'path'
import { getCallbacks } from '@vt/graph-model'

export async function resolveContextWriteFolder(fallbackNodeId?: string): Promise<string> {
    const callbackWriteFolder: string | null | undefined = await getCallbacks().getWriteFolder?.()
    if (callbackWriteFolder) {
        return callbackWriteFolder
    }

    return fallbackNodeId ? path.dirname(fallbackNodeId) : ''
}
