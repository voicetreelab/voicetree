import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { initializeProject } from './project-initializer';

describe('initializeProject', () => {
    let testProjectDir: string;
    let testOnboardingDir: string;

    beforeEach(async () => {
        // Create a test directory to simulate a project
        testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-init-test-'));

        // Create a test onboarding source directory with mock files
        testOnboardingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voicetree-onboarding-'));
        await fs.writeFile(
            path.join(testOnboardingDir, 'welcome_to_voicetree.md'),
            '# Welcome to VoiceTree\n\nThis is a test welcome file.',
            'utf-8'
        );
        await fs.writeFile(
            path.join(testOnboardingDir, 'hover_over_me.md'),
            '# Hover Over Me\n\nInteractive tutorial content.',
            'utf-8'
        );
        await fs.writeFile(
            path.join(testOnboardingDir, 'run_me.md'),
            '# Run Me\n\nQuick start instructions.',
            'utf-8'
        );
        // Create a non-.md file that should NOT be copied
        await fs.writeFile(
            path.join(testOnboardingDir, 'config.json'),
            '{"test": true}',
            'utf-8'
        );
        // Create a subdirectory that should NOT be copied
        await fs.mkdir(path.join(testOnboardingDir, 'chromadb_data'), { recursive: true });
        await fs.writeFile(
            path.join(testOnboardingDir, 'chromadb_data', 'data.bin'),
            'binary data',
            'utf-8'
        );
    });

    afterEach(async () => {
        await fs.rm(testProjectDir, { recursive: true, force: true });
        await fs.rm(testOnboardingDir, { recursive: true, force: true });
    });

    it('should create voicetree folder on first open', async () => {
        const result: boolean = await initializeProject(testProjectDir, testOnboardingDir);

        expect(result).toBe(true);

        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        const dirExists: boolean = await fs.access(voicetreeDir).then(
            () => true,
            () => false
        );
        expect(dirExists).toBe(true);
    });

    it('should copy onboarding .md files to voicetree folder', async () => {
        await initializeProject(testProjectDir, testOnboardingDir);

        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        const files: string[] = await fs.readdir(voicetreeDir);

        // Should have exactly 3 .md files copied
        expect(files).toContain('welcome_to_voicetree.md');
        expect(files).toContain('hover_over_me.md');
        expect(files).toContain('run_me.md');
        expect(files.length).toBe(3);

        // Verify content is copied correctly
        const welcomeContent: string = await fs.readFile(
            path.join(voicetreeDir, 'welcome_to_voicetree.md'),
            'utf-8'
        );
        expect(welcomeContent).toBe('# Welcome to VoiceTree\n\nThis is a test welcome file.');
    });

    it('should not copy non-.md files', async () => {
        await initializeProject(testProjectDir, testOnboardingDir);

        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        const files: string[] = await fs.readdir(voicetreeDir);

        expect(files).not.toContain('config.json');
    });

    it('should not copy subdirectories', async () => {
        await initializeProject(testProjectDir, testOnboardingDir);

        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        const files: string[] = await fs.readdir(voicetreeDir);

        expect(files).not.toContain('chromadb_data');
    });

    it('should skip initialization if voicetree folder already exists', async () => {
        // Pre-create the voicetree folder
        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        await fs.mkdir(voicetreeDir, { recursive: true });

        // Create a custom file to verify it's not overwritten
        const customFile: string = path.join(voicetreeDir, 'custom.md');
        await fs.writeFile(customFile, 'custom content', 'utf-8');

        const result: boolean = await initializeProject(testProjectDir, testOnboardingDir);

        expect(result).toBe(false);

        // Verify custom file still exists and was not modified
        const content: string = await fs.readFile(customFile, 'utf-8');
        expect(content).toBe('custom content');

        // Verify onboarding files were NOT copied
        const files: string[] = await fs.readdir(voicetreeDir);
        expect(files).not.toContain('welcome_to_voicetree.md');
    });

    it('should not overwrite existing voicetree folder contents', async () => {
        // Pre-create the voicetree folder with custom file
        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        await fs.mkdir(voicetreeDir, { recursive: true });
        const customFile: string = path.join(voicetreeDir, 'my_notes.md');
        await fs.writeFile(customFile, 'my custom notes', 'utf-8');

        await initializeProject(testProjectDir, testOnboardingDir);

        // Verify custom file was not modified
        const content: string = await fs.readFile(customFile, 'utf-8');
        expect(content).toBe('my custom notes');
    });

    it('should create empty voicetree folder when no onboarding source provided', async () => {
        const result: boolean = await initializeProject(testProjectDir);

        expect(result).toBe(true);

        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        const dirExists: boolean = await fs.access(voicetreeDir).then(
            () => true,
            () => false
        );
        expect(dirExists).toBe(true);

        // Should be empty
        const files: string[] = await fs.readdir(voicetreeDir);
        expect(files.length).toBe(0);
    });

    it('should create empty voicetree folder when onboarding source does not exist', async () => {
        const nonExistentPath: string = '/non/existent/path/to/onboarding';
        const result: boolean = await initializeProject(testProjectDir, nonExistentPath);

        expect(result).toBe(true);

        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        const dirExists: boolean = await fs.access(voicetreeDir).then(
            () => true,
            () => false
        );
        expect(dirExists).toBe(true);

        // Should be empty since source doesn't exist
        const files: string[] = await fs.readdir(voicetreeDir);
        expect(files.length).toBe(0);
    });
});
