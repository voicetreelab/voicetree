// Bounded request-body reader shared by /rpc and /hook (§4.1: 64 KiB cap).
// Returns the resolved utf8 body OR a `{tooLarge: true}` sentinel so the
// caller can map the latter to HTTP 413 without throwing. Streaming check
// short-circuits the moment the cumulative byte count exceeds the cap; we
// do NOT buffer past the cap then check after `end`.

import type {IncomingMessage} from 'node:http'

export const BODY_LIMIT_BYTES: number = 64 * 1024

export function readBodyWithCap(
    req: IncomingMessage,
): Promise<string | {readonly tooLarge: true}> {
    return new Promise<string | {readonly tooLarge: true}>((resolveBody, rejectBody): void => {
        const chunks: Buffer[] = []
        let total: number = 0
        let settled: boolean = false
        req.on('data', (chunk: Buffer): void => {
            if (settled) return
            total += chunk.length
            if (total > BODY_LIMIT_BYTES) {
                settled = true
                resolveBody({tooLarge: true})
                return
            }
            chunks.push(chunk)
        })
        req.on('end', (): void => {
            if (settled) return
            settled = true
            resolveBody(Buffer.concat(chunks).toString('utf8'))
        })
        req.on('error', (cause: Error): void => {
            if (settled) return
            settled = true
            rejectBody(cause)
        })
    })
}
