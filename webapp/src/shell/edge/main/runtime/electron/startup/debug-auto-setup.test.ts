import { describe, expect, it } from 'vitest';
import { getDebugAutoSetupReason } from './debug-auto-setup';

describe('getDebugAutoSetupReason', () => {
    it('returns a reason only when vt-debug autolaunch is explicit', () => {
        expect(getDebugAutoSetupReason({ VT_DEBUG_AUTOLAUNCHED: '1' })).toBe('vt-debug autolaunch');
    });

    // Regression guard: ENABLE_PLAYWRIGHT_DEBUG is auto-set for all unpackaged dev builds
    // (environment-config.ts) so it must NOT trigger the bootstrap that spawns fake agents.
    it('does not bootstrap on plain ENABLE_PLAYWRIGHT_DEBUG=1', () => {
        expect(getDebugAutoSetupReason({ ENABLE_PLAYWRIGHT_DEBUG: '1' })).toBeNull();
    });

    it('returns null for an empty environment', () => {
        expect(getDebugAutoSetupReason({})).toBeNull();
    });
});
