// Re-export shim — the canonical wire types live in @vt/vt-daemon-protocol
// (re-exported via @vt/vt-daemon-client). Webapp's UI-side TerminalData
// mirror layers an optional `ui` field via intersection in
// `floating-windows/anchoring/types.ts`; this file exists so existing
// imports keep working.

export type { TerminalData, CreateTerminalDataParams } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
