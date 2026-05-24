/**
 * Local "ports" file for the autoLaunch module — the single boundary
 * between graph-db-client and @vt/graph-db-protocol for type-only access.
 * Sibling files inside autoLaunch import shared protocol types from here
 * (Pattern P1 — hexagonal package ports) instead of reaching for the
 * protocol package directly. Values still cross the boundary at the
 * specific source sites that use them (ownerRecordIo, healthIdentityProbe).
 */

export type {
  CallerKind,
  CommandFingerprint,
  OwnerHealthIdentity,
  OwnerRecord,
} from '@vt/graph-db-protocol'

export interface EnsureDaemonResult {
  port: number
  pid: number | null
  launched: boolean
}
