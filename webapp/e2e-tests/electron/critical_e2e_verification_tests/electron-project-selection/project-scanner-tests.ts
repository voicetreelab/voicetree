import { expect } from '@playwright/test';
import * as path from 'path';
import { test } from './fixtures';
import type { ExtendedWindow } from './types';

test.describe('Project Scanner Integration', () => {
    test('should detect git repositories when scanning', async ({ appWindow, testProjectPath }) => {
        test.setTimeout(30000);
        console.log('=== TEST: Scanner detects git repositories ===');

        await appWindow.waitForSelector('text=Voicetree', { timeout: 10000 });

        const parentDir = path.dirname(testProjectPath);
        const discovered = await appWindow.evaluate(async (searchDir: string) => {
            const api = (window as ExtendedWindow).electronAPI;
            if (!api) throw new Error('electronAPI not available');
            return await api.main.scanForProjects([searchDir]);
        }, parentDir);

        console.log('Discovered projects:', discovered);

        const foundTestProject = discovered.some(
            (p: { path: string; type: string }) => p.path === testProjectPath && p.type === 'git'
        );
        expect(foundTestProject).toBe(true);
        console.log('✓ Git repository detected by scanner');

        console.log('✅ Scanner test passed!');
    });
});
