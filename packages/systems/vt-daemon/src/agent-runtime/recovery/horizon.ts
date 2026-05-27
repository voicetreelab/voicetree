const MS_PER_DAY: number = 24 * 60 * 60 * 1000
const DEFAULT_HORIZON_DAYS: number = 7

export const RECOVERY_HORIZON_MS: number = DEFAULT_HORIZON_DAYS * MS_PER_DAY

/**
 * Resolve the active recovery-horizon window in ms.
 *
 * Default is 7 days. `process.env.VOICETREE_RECOVERY_HORIZON_DAYS` overrides at
 * read time so test fixtures (and the user's $VOICETREE_RECOVERY_HORIZON_DAYS
 * shell override) take effect without rebuilding. Non-finite or non-positive
 * values fall back to the default.
 */
export function getRecoveryHorizonMs(): number {
    const raw: string | undefined = process.env.VOICETREE_RECOVERY_HORIZON_DAYS
    if (!raw) return RECOVERY_HORIZON_MS
    const days: number = Number(raw)
    if (!Number.isFinite(days) || days <= 0) return RECOVERY_HORIZON_MS
    return days * MS_PER_DAY
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
