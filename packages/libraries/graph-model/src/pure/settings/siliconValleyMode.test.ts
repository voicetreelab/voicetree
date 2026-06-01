import {describe, it, expect} from 'vitest';
import {createSettingsSchema, createDefaultSettings} from './settingsSchema';

// The prank's behavioural contract: on by default, in the General tab, directly
// above Vim Mode. These lock the requirements so a later refactor can't silently
// drop the default or move the toggle.
describe('siliconValleyMode setting', () => {
    it('is on by default', () => {
        expect(createDefaultSettings().siliconValleyMode).toBe(true);
    });

    it('lives in the General section', () => {
        expect(createSettingsSchema().siliconValleyMode.section).toBe('general');
    });

    it('renders directly above Vim Mode (schema declaration order = UI order)', () => {
        const keys: readonly string[] = Object.keys(createSettingsSchema());
        const sv: number = keys.indexOf('siliconValleyMode');
        const vim: number = keys.indexOf('vimMode');
        expect(sv).toBeGreaterThanOrEqual(0);
        expect(vim).toBeGreaterThanOrEqual(0);
        expect(sv).toBeLessThan(vim);
    });
});
