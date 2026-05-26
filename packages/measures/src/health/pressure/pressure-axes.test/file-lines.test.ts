import {readFile} from 'node:fs/promises'
import type {FileLinesRow, SystemFile} from './types.test'

export async function measureFileLines(files: readonly SystemFile[]): Promise<FileLinesRow[]> {
    const rows: FileLinesRow[] = []
    for (const file of files) {
        const text = await readFile(file.absolutePath, 'utf8')
        rows.push({file: file.relativePath, lineCount: text.split('\n').length})
    }
    return rows.sort((a, b) => b.lineCount - a.lineCount || a.file.localeCompare(b.file))
}
