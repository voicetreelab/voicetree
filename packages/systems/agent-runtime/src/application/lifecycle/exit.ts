/**
 * Pure classification of process-exit events.
 *
 * Inputs:
 *   - exit code (null if process was signalled)
 *   - signal name (null if process exited cleanly)
 *   - kill reason (null unless VoiceTree initiated termination)
 *
 * Output: 'completed' | 'errored'
 */

import type { TerminalKillReason } from './types';

export type ExitClassification = 'completed' | 'errored';

/**
 * Crash signals — kernel-delivered for genuinely broken processes.
 * SIGSEGV: invalid memory access. SIGABRT: assert/abort. SIGBUS: bus error.
 * SIGILL: illegal instruction. SIGFPE: floating point error.
 */
function isCrashSignal(signal: string): boolean {
    switch (signal) {
        case 'SIGSEGV':
        case 'SIGABRT':
        case 'SIGBUS':
        case 'SIGILL':
        case 'SIGFPE':
            return true;
        default:
            return false;
    }
}

export function classifyExit(
    code: number | null,
    signal: string | null,
    killReason: TerminalKillReason | null,
): ExitClassification {
    // VoiceTree-initiated kill: user wanted this. Clean ending, just abrupt.
    if (killReason === 'user') return 'completed';

    // Crash signals always errored, regardless of how we got the kill reason.
    if (signal !== null && isCrashSignal(signal)) return 'errored';

    // Any other signal with no recorded user intent: external kill → errored.
    if (signal !== null) return 'errored';

    // Pure exit codes.
    if (code === 0) return 'completed';
    if (code === null) return 'errored'; // unknown — treat as failure

    return 'errored';
}
