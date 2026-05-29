import * as path from 'path';
import * as fs from 'fs/promises';

export const PROJECT_ROOT = path.resolve(process.cwd());
export const FIXTURE_PROJECT_PATH = path.join(
  PROJECT_ROOT,
  'example_folder_fixtures',
  'example_real_large',
  '2025-09-30'
);

export const INCREMENTAL_TEST_FILE_NAMES = [
  'incremental-test-1.md',
  'incremental-test-2.md',
  'incremental-test-3.md'
];

export const filePathInProject = (fileName: string): string => path.join(FIXTURE_PROJECT_PATH, fileName);

export const writeProjectFile = async (fileName: string, content: string): Promise<string> => {
  const filePath = filePathInProject(fileName);
  await fs.writeFile(filePath, content);
  return filePath;
};

export const deleteProjectFile = async (fileName: string): Promise<void> => {
  await fs.unlink(filePathInProject(fileName));
};

export const deleteFilePath = async (filePath: string): Promise<void> => {
  await fs.unlink(filePath);
};

export const readTextFile = (filePath: string): Promise<string> => fs.readFile(filePath, 'utf-8');

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const deleteProjectFilesIfPresent = async (fileNames: readonly string[]): Promise<void> => {
  for (const fileName of fileNames) {
    try {
      await deleteProjectFile(fileName);
      console.log(`Cleaned up leftover file: ${fileName}`);
    } catch {
      // File doesn't exist, which is fine
    }
  }
};
