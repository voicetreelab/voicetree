// Re-export shim — terminal types live in @vt/agent-runtime now.
// Webapp's UI-side TerminalData layers an optional `ui` field via intersection
// in `floating-windows/types.ts`; this file exists so existing imports keep working.

export type { TerminalData, CreateTerminalDataParams } from '@/shell/edge/UI-edge/floating-windows/types';
