import { randomUUID } from 'node:crypto'
import { readCurrentFolderState } from '@vt/graph-db-server/views/folderVisibilityResource'
import type { FolderState } from '../../daemon/contract.ts'
import type { Session } from './types.ts'
export type { Session } from './types.ts'

export type SessionRegistryDependencies = {
  readonly createId: () => string
  readonly now: () => number
}

const defaultSessionRegistryDependencies: SessionRegistryDependencies = {
  createId: randomUUID,
  now: () => Date.now(),
}

function normalizeFolderId(path: string): string {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function readFolderStateRows(): readonly (readonly [string, FolderState])[] {
  try {
    return readCurrentFolderState().folderState
  } catch {
    return []
  }
}

function deriveCollapsedFolderIds(folderState: ReadonlyMap<string, FolderState>): readonly string[] {
  return [...folderState]
    .filter(([, state]) => state === 'collapsed')
    .map(([path]) => normalizeFolderId(path))
}

function createSession(
  dependencies: SessionRegistryDependencies,
  id?: string,
): Session {
  const folderState = new Map<string, FolderState>(readFolderStateRows())
  return {
    id: id ?? dependencies.createId(),
    folderState,
    collapseSet: new Set<string>(deriveCollapsedFolderIds(folderState)),
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

  clear(): void {
    this.#sessions.clear()
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
