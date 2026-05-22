import path from 'path'
import { getCallbacks } from '@vt/graph-model'

export async function resolveContextWritePath(fallbackNodeId?: string): Promise<string> {
    const callbackWritePath: string | null | undefined = await getCallbacks().getWritePath?.()
    if (callbackWritePath) {
        return callbackWritePath
    }

    return fallbackNodeId ? path.dirname(fallbackNodeId) : ''
}
