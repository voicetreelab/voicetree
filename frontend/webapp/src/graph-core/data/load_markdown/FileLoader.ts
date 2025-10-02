import { loadMarkdownTree } from './MarkdownParser';
import { MarkdownTree } from '@/graph-core/types';

/**
 * Cross-browser file loading utility for markdown files
 * Supports single files, multiple files, and directory selection
 * Returns canonical MarkdownTree structure
 */
export class FileLoader {
  /**
   * Create file input element for single file selection
   */
  private static createFileInput(accept: string = '.md', multiple: boolean = false, directory: boolean = false): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (directory) {
      input.setAttribute('webkitdirectory', '');
    }
    input.style.display = 'none';
    return input;
  }

  /**
   * Read file content as text
   */
  private static readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /**
   * Filter files to only include markdown files
   */
  private static filterMarkdownFiles(files: FileList): File[] {
    return Array.from(files).filter(file =>
      file.name.endsWith('.md') || file.type === 'text/markdown'
    );
  }

  /**
   * Process files into Map<filename, content> format expected by MarkdownParser
   */
  private static async processFiles(files: File[]): Promise<Map<string, string>> {
    const fileMap = new Map<string, string>();

    for (const file of files) {
      try {
        const content = await this.readFileAsText(file);
        fileMap.set(file.name, content);
      } catch (error) {
        console.warn(`Failed to read file ${file.name}:`, error);
      }
    }

    return fileMap;
  }

  /**
   * Open file picker for single markdown file
   */
  static async pickSingleFile(): Promise<MarkdownTree | null> {
    return new Promise((resolve) => {
      const input = this.createFileInput('.md', false, false);

      input.onchange = async () => {
        const files = input.files;
        if (!files || files.length === 0) {
          resolve(null);
          return;
        }

        const markdownFiles = this.filterMarkdownFiles(files);
        if (markdownFiles.length === 0) {
          console.warn('No markdown files selected');
          resolve(null);
          return;
        }

        const fileMap = await this.processFiles(markdownFiles);
        const tree = loadMarkdownTree(fileMap);
        resolve(tree);
      };

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    });
  }

  /**
   * Open file picker for multiple markdown files
   */
  static async pickMultipleFiles(): Promise<MarkdownTree | null> {
    return new Promise((resolve) => {
      const input = this.createFileInput('.md', true, false);

      input.onchange = async () => {
        const files = input.files;
        if (!files || files.length === 0) {
          resolve(null);
          return;
        }

        const markdownFiles = this.filterMarkdownFiles(files);
        if (markdownFiles.length === 0) {
          console.warn('No markdown files selected');
          resolve(null);
          return;
        }

        const fileMap = await this.processFiles(markdownFiles);
        const tree = loadMarkdownTree(fileMap);
        resolve(tree);
      };

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    });
  }

  /**
   * Open directory picker for folder containing markdown files
   */
  static async pickDirectory(): Promise<MarkdownTree | null> {
    return new Promise((resolve) => {
      const input = this.createFileInput('', false, true);

      input.onchange = async () => {
        const files = input.files;
        if (!files || files.length === 0) {
          resolve(null);
          return;
        }

        const markdownFiles = this.filterMarkdownFiles(files);
        if (markdownFiles.length === 0) {
          console.warn('No markdown files found in selected directory');
          resolve(null);
          return;
        }

        const fileMap = await this.processFiles(markdownFiles);
        const tree = loadMarkdownTree(fileMap);
        resolve(tree);
      };

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    });
  }

  /**
   * Create drag & drop zone that accepts markdown files
   * Returns a div element that can be styled and placed in the DOM
   */
  static createDropZone(onFilesLoaded: (tree: MarkdownTree) => void): HTMLDivElement {
    const dropZone = document.createElement('div');
    dropZone.style.border = '2px dashed #ccc';
    dropZone.style.borderRadius = '8px';
    dropZone.style.padding = '20px';
    dropZone.style.textAlign = 'center';
    dropZone.style.cursor = 'pointer';
    dropZone.textContent = 'Drop markdown files here or click to browse';

    // Handle drag & drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#007acc';
      dropZone.style.backgroundColor = '#f0f8ff';
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = '#ccc';
      dropZone.style.backgroundColor = '';
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#ccc';
      dropZone.style.backgroundColor = '';

      const files = Array.from(e.dataTransfer?.files || []);
      const markdownFiles = files.filter(file =>
        file.name.endsWith('.md') || file.type === 'text/markdown'
      );

      if (markdownFiles.length === 0) {
        console.warn('No markdown files dropped');
        return;
      }

      const fileMap = await this.processFiles(markdownFiles);
      const tree = loadMarkdownTree(fileMap);
      onFilesLoaded(tree);
    });

    // Handle click to open file picker
    dropZone.addEventListener('click', async () => {
      const tree = await this.pickMultipleFiles();
      if (tree) {
        onFilesLoaded(tree);
      }
    });

    return dropZone;
  }

  /**
   * Handle paste events for file loading (Ctrl+V)
   */
  static setupPasteHandler(onFilesLoaded: (tree: MarkdownTree) => void): void {
    document.addEventListener('paste', async (e) => {
      const files = Array.from(e.clipboardData?.files || []);
      const markdownFiles = files.filter(file =>
        file.name.endsWith('.md') || file.type === 'text/markdown'
      );

      if (markdownFiles.length === 0) {
        return; // No markdown files pasted
      }

      e.preventDefault();
      const fileMap = await this.processFiles(markdownFiles);
      const tree = loadMarkdownTree(fileMap);
      onFilesLoaded(tree);
    });
  }
}
