import { randomUUID } from 'node:crypto'
import type { Session } from './types.ts'

export type SessionRegistryDependencies = {
  readonly createId: () => string
  readonly now: () => number
}

const defaultSessionRegistryDependencies: SessionRegistryDependencies = {
  createId: randomUUID,
  now: () => Date.now(),
}

function createSession(
  dependencies: SessionRegistryDependencies,
  id?: string,
): Session {
  return {
    id: id ?? dependencies.createId(),
    collapseSet: new Set<string>(),
    selection: new Set<string>(),
    expandOverrides: new Set<string>(),
    layout: {
      positions: {},
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    lastAccessedAt: dependencies.now(),
  }
}

export class SessionRegistry {
  readonly #sessions = new Map<string, Session>()
  readonly #dependencies: SessionRegistryDependencies

  constructor(dependencies: SessionRegistryDependencies = defaultSessionRegistryDependencies) {
    this.#dependencies = dependencies
  }

  create(): Session {
    const session = createSession(this.#dependencies)
    this.#sessions.set(session.id, session)
    return session
  }

  get(id: string): Session | null {
    const session = this.#sessions.get(id) ?? null
    if (session) {
      session.lastAccessedAt = this.#dependencies.now()
    }
    return session
  }

  getOrCreate(id: string): Session {
    const existing = this.#sessions.get(id)
    if (existing) {
      existing.lastAccessedAt = this.#dependencies.now()
      return existing
    }
    const session = createSession(this.#dependencies, id)
    this.#sessions.set(id, session)
    return session
  }

  delete(id: string): boolean {
    return this.#sessions.delete(id)
  }

  touch(id: string): void {
    const session = this.#sessions.get(id)
    if (session) {
      session.lastAccessedAt = this.#dependencies.now()
    }
  }

  purgeIdle(maxAgeMs: number): number {
    const cutoff = this.#dependencies.now() - maxAgeMs
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
