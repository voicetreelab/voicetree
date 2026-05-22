import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { initializeProject, generateDateSubfolder } from './project-initializer';

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
            '# Welcome to Voicetree\n\nThis is a test welcome file.',
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

    it('should create voicetree-{date} folder on first open', async () => {
        const result: string | null = await initializeProject(testProjectDir, testOnboardingDir);

        // Should return the path to the created folder
        expect(result).not.toBeNull();
        expect(result).toContain('voicetree-');

        // Verify folder exists
        const dirExists: boolean = await fs.access(result!).then(
            () => true,
            () => false
        );
        expect(dirExists).toBe(true);
    });

    it('should copy onboarding .md files to voicetree folder', async () => {
        const result: string | null = await initializeProject(testProjectDir, testOnboardingDir);
        expect(result).not.toBeNull();

        const files: string[] = await fs.readdir(result!);

        // Should have exactly 3 .md files copied
        expect(files).toContain('welcome_to_voicetree.md');
        expect(files).toContain('hover_over_me.md');
        expect(files).toContain('run_me.md');
        expect(files.length).toBe(3);

        // Verify content is copied correctly
        const welcomeContent: string = await fs.readFile(
            path.join(result!, 'welcome_to_voicetree.md'),
            'utf-8'
        );
        expect(welcomeContent).toBe('# Welcome to Voicetree\n\nThis is a test welcome file.');
    });

    it('should not copy non-.md files', async () => {
        const result: string | null = await initializeProject(testProjectDir, testOnboardingDir);
        expect(result).not.toBeNull();

        const files: string[] = await fs.readdir(result!);
        expect(files).not.toContain('config.json');
    });

    it('should not copy subdirectories', async () => {
        const result: string | null = await initializeProject(testProjectDir, testOnboardingDir);
        expect(result).not.toBeNull();

        const files: string[] = await fs.readdir(result!);
        expect(files).not.toContain('chromadb_data');
    });

    it('should return existing voicetree folder if already exists', async () => {
        // Pre-create a voicetree folder (old format)
        const voicetreeDir: string = path.join(testProjectDir, 'voicetree');
        await fs.mkdir(voicetreeDir, { recursive: true });

        // Create a custom file to verify it's not overwritten
        const customFile: string = path.join(voicetreeDir, 'custom.md');
        await fs.writeFile(customFile, 'custom content', 'utf-8');

        const result: string | null = await initializeProject(testProjectDir, testOnboardingDir);

        // Should return path to existing folder
        expect(result).toBe(voicetreeDir);

        // Verify custom file still exists and was not modified
        const content: string = await fs.readFile(customFile, 'utf-8');
        expect(content).toBe('custom content');

        // Verify onboarding files were NOT copied
        const files: string[] = await fs.readdir(voicetreeDir);
        expect(files).not.toContain('welcome_to_voicetree.md');
    });

    it('should return existing voicetree-{date} folder if already exists', async () => {
        // Pre-create a voicetree-{date} folder
        const voicetreeDir: string = path.join(testProjectDir, 'voicetree-15-6');
        await fs.mkdir(voicetreeDir, { recursive: true });

        // Create a custom file
        const customFile: string = path.join(voicetreeDir, 'my_notes.md');
        await fs.writeFile(customFile, 'my custom notes', 'utf-8');

        const result: string | null = await initializeProject(testProjectDir, testOnboardingDir);

        // Should return path to existing folder (not create a new one)
        expect(result).toBe(voicetreeDir);

        // Verify custom file was not modified
        const content: string = await fs.readFile(customFile, 'utf-8');
        expect(content).toBe('my custom notes');
    });

    it('should create empty voicetree folder when no onboarding source provided', async () => {
        const result: string | null = await initializeProject(testProjectDir);

        expect(result).not.toBeNull();
        expect(result).toContain('voicetree-');

        const dirExists: boolean = await fs.access(result!).then(
            () => true,
            () => false
        );
        expect(dirExists).toBe(true);

        // Should be empty
        const files: string[] = await fs.readdir(result!);
        expect(files.length).toBe(0);
    });

    it('should create empty voicetree folder when onboarding source does not exist', async () => {
        const nonExistentPath: string = '/non/existent/path/to/onboarding';
        const result: string | null = await initializeProject(testProjectDir, nonExistentPath);

        expect(result).not.toBeNull();
        expect(result).toContain('voicetree-');

        const dirExists: boolean = await fs.access(result!).then(
            () => true,
            () => false
        );
        expect(dirExists).toBe(true);

        // Should be empty since source doesn't exist
        const files: string[] = await fs.readdir(result!);
        expect(files.length).toBe(0);
    });
});

describe('generateDateSubfolder', () => {
    it('should generate folder name in voicetree-{day}-{month} format', () => {
        const result: string = generateDateSubfolder();
        expect(result).toMatch(/^voicetree-\d{1,2}-\d{1,2}$/);
    });
});
