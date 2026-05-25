import type {GraphDbClient} from '@vt/graph-db-client'
import {ArgValidationError} from './exitCodes'

// Session IDs travel only in `/sessions/:sessionId/...` path params.
// `X-Session-Id` header transport is intentionally not implemented here.
type ParseSessionFlagResult = {
    remaining: string[]
    session?: string
}

function hasSessionId(value: string | undefined): value is string {
    return typeof value === 'string' && value.length > 0
}

export function parseSessionFlag(argv: string[]): ParseSessionFlagResult {
    const remaining: string[] = []
    let session: string | undefined

    for (let index: number = 0; index < argv.length; index += 1) {
        const current: string = argv[index]

        if (current !== '--session') {
            remaining.push(current)
            continue
        }

        const next: string | undefined = argv[index + 1]
        if (!hasSessionId(next) || next.startsWith('-')) {
            throw new ArgValidationError('--session requires a non-empty value')
        }

        session = next
        index += 1
    }

    return session === undefined ? {remaining} : {remaining, session}
}

export async function resolveSessionId({
    flag,
    env,
    client,
}: {
    flag?: string
    env?: string
    client: GraphDbClient
}): Promise<string> {
    if (hasSessionId(flag)) {
        return flag
    }

    if (hasSessionId(env)) {
        return env
    }

    const {sessionId}: {sessionId: string} = await client.createSession()
    return sessionId
}
