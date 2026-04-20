export type SessionLayoutPosition = {
  x: number
  y: number
}

export type SessionViewport = {
  x: number
  y: number
}

export type SessionLayout = {
  positions: Record<string, SessionLayoutPosition>
  pan: SessionViewport
  zoom: number
}

export interface Session {
  readonly id: string
  collapseSet: Set<string>
  selection: Set<string>
  layout: SessionLayout
  lastAccessedAt: number
}
