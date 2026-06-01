import {describe, expect, it} from 'vitest';
import {formatUserDataMigrationNotice} from './user-data-migration-notice.ts';

describe('formatUserDataMigrationNotice', () => {
    it('announces settings and pluralized recent projects', () => {
        expect(formatUserDataMigrationNotice({settingsImported: true, projectCount: 3}))
            .toBe('Imported your settings & 3 recent projects from your previous version');
    });

    it('uses the singular for a single project', () => {
        expect(formatUserDataMigrationNotice({settingsImported: true, projectCount: 1}))
            .toBe('Imported your settings & 1 recent project from your previous version');
    });

    it('omits projects when none were imported', () => {
        expect(formatUserDataMigrationNotice({settingsImported: true, projectCount: 0}))
            .toBe('Imported your settings from your previous version');
    });

    it('omits settings when only projects were imported', () => {
        expect(formatUserDataMigrationNotice({settingsImported: false, projectCount: 2}))
            .toBe('Imported 2 recent projects from your previous version');
    });

    it('returns null when there is nothing to announce', () => {
        expect(formatUserDataMigrationNotice({settingsImported: false, projectCount: 0})).toBeNull();
    });
});
