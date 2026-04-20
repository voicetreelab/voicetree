import { randomUUID } from 'node:crypto'
import type { Session } from './types.ts'

function createSession(): Session {
  return {
    id: randomUUID(),
    collapseSet: new Set<string>(),
    selection: new Set<string>(),
    layout: {
      positions: {},
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    lastAccessedAt: Date.now(),
  }
}

export class SessionRegistry {
  readonly #sessions = new Map<string, Session>()

  create(): Session {
    const session = createSession()
    this.#sessions.set(session.id, session)
    return session
  }

  get(id: string): Session | null {
    const session = this.#sessions.get(id) ?? null
    if (session) {
      session.lastAccessedAt = Date.now()
    }
    return session
  }

  delete(id: string): boolean {
    return this.#sessions.delete(id)
  }

  touch(id: string): void {
    const session = this.#sessions.get(id)
    if (session) {
      session.lastAccessedAt = Date.now()
    }
  }

  purgeIdle(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs
    let removed = 0
    for (const [id, session] of this.#sessions) {
      if (session.lastAccessedAt <= cutoff) {
        this.#sessions.delete(id)
        removed += 1
      }
    }
    return removed
  }

  size(): number {
    return this.#sessions.size
  }
}
