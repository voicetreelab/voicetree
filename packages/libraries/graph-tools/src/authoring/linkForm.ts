import {basename, dirname, relative} from 'node:path'

export function canonicalLinkText(
    sourceNodeAbsPath: string,
    targetNodeAbsPath: string,
    projectRoot: string
): string {
    if (dirname(sourceNodeAbsPath) === dirname(targetNodeAbsPath)) {
        return basename(targetNodeAbsPath, '.md')
    }

    return relative(projectRoot, targetNodeAbsPath)
        .replace(/\\/g, '/')
        .replace(/\.md$/i, '')
}
