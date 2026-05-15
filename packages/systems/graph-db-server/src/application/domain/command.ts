import type { VaultState } from '@vt/graph-db-server/contract'
import type { Session } from './session.ts'

export type Command =
  | { type: 'AddVaultReadPath'; path: string }
  | { type: 'InitializeGraphModel'; appSupportPath: string }
  | { type: 'ReadVaultState' }
  | { type: 'RegistryTouch'; sessionId: string }
  | { type: 'RemoveVaultReadPath'; path: string }
  | { type: 'ProjectAndBroadcast'; session: Session }
  | { type: 'SetVaultWritePath'; path: string }

export type CommandOutput = {
  AddVaultReadPath: { readonly success: boolean; readonly error?: string }
  InitializeGraphModel: void
  ProjectAndBroadcast: void
  ReadVaultState: VaultState
  RegistryTouch: void
  RemoveVaultReadPath: { readonly success: boolean; readonly error?: string }
  SetVaultWritePath: { readonly success: boolean; readonly error?: string }
}
