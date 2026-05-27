/**
 * Tiny pub/sub mailbox for stdin-arrived messages. Producers push messages
 * in; consumers either drain pre-queued ones (shift) or register matcher
 * predicates (waitFor) that resolve as soon as a matching message arrives —
 * whether already queued or pushed later. Single-consumer-per-matcher: when
 * a push resolves a waiter, the matched message is delivered directly and
 * not enqueued.
 */
export type MessageMatcher = (message: string) => boolean

export type MessageInbox = {
  push(message: string): void
  shift(): string | undefined
  size(): number
  waitFor(matcher: MessageMatcher): Promise<string>
}

type PendingWait = {
  readonly matcher: MessageMatcher
  readonly resolve: (message: string) => void
}

export function createMessageInbox(): MessageInbox {
  const queued: string[] = []
  const waits: PendingWait[] = []

  return {
    push(message: string): void {
      const waitIndex = waits.findIndex(({matcher}) => matcher(message))
      if (waitIndex !== -1) {
        const [{resolve}] = waits.splice(waitIndex, 1)
        resolve(message)
        return
      }
      queued.push(message)
    },
    shift(): string | undefined {
      return queued.shift()
    },
    size(): number {
      return queued.length
    },
    waitFor(matcher: MessageMatcher): Promise<string> {
      const queuedIndex = queued.findIndex((message) => matcher(message))
      if (queuedIndex !== -1) {
        const [message] = queued.splice(queuedIndex, 1)
        return Promise.resolve(message)
      }
      return new Promise<string>((resolve) => {
        waits.push({matcher, resolve})
      })
    },
  }
}
