import type { Session } from './session.ts'

export type Command =
  | { type: 'RegistryTouch'; sessionId: string }
  | { type: 'ProjectAndBroadcast'; session: Session }
