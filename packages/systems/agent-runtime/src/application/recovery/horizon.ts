const MS_PER_DAY: number = 24 * 60 * 60 * 1000
const DEFAULT_HORIZON_DAYS: number = 7

export const RECOVERY_HORIZON_MS: number = DEFAULT_HORIZON_DAYS * MS_PER_DAY

/**
 * Resolve the active recovery-horizon window in ms from a caller-supplied
 * `horizonDays` override (typically threaded through `RecoveryEnv.recoveryConfig`
 * after the shell reads `process.env.VOICETREE_RECOVERY_HORIZON_DAYS`).
 *
 * Returns the 7-day default when the input is undefined, non-finite, or
 * non-positive — those treat malformed config as "no override" rather than
 * propagating bad data.
 */
export function resolveRecoveryHorizonMs(horizonDays: number | undefined): number {
    if (horizonDays === undefined) return RECOVERY_HORIZON_MS
    if (!Number.isFinite(horizonDays) || horizonDays <= 0) return RECOVERY_HORIZON_MS
    return horizonDays * MS_PER_DAY
}

/**
 * Parse an ISO timestamp from metadata into ms epoch, or 0 if missing/invalid.
 *
 * Distinguishing 0 from a real timestamp lets callers decide how to handle
 * unknown ages (the discovery horizon filter treats 0 as "unknown — surface
 * the row rather than silently hiding it").
 */
export function isoToMsOrZero(iso: string | undefined): number {
    if (!iso) return 0
    const parsed: number = Date.parse(iso)
    return Number.isFinite(parsed) ? parsed : 0
}
