import { promises as fs, Dirent } from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import { parseSkillFile, formatParsedSkillSummary } from '@/pure/workflows/parseSkillFile'

const WORKFLOWS_DIR: string = path.join(os.homedir(), 'brain', 'workflows')

export async function listWorkflows(): Promise<Array<{ name: string; path: string; hasSkillFile: boolean }>> {
    let entries: Dirent[]
    try {
        entries = await fs.readdir(WORKFLOWS_DIR, { withFileTypes: true })
    } catch {
        await fs.mkdir(WORKFLOWS_DIR, { recursive: true })
        return []
    }

    const subdirs: Dirent[] = entries.filter(e => e.isDirectory())
    const results: Array<{ name: string; path: string; hasSkillFile: boolean }> = await Promise.all(
        subdirs.map(async (sub): Promise<{ name: string; path: string; hasSkillFile: boolean }> => {
            const dirPath: string = path.join(WORKFLOWS_DIR, sub.name)
            const skillPath: string = path.join(dirPath, 'SKILL.md')
            let hasSkillFile: boolean = false
            try {
                await fs.access(skillPath)
                hasSkillFile = true
            } catch { /* no SKILL.md */ }
            return { name: sub.name, path: dirPath, hasSkillFile }
        })
    )

    return results.filter(r => r.hasSkillFile)
}

export async function readSkillFile(workflowPath: string): Promise<string> {
    const raw: string = await fs.readFile(path.join(workflowPath, 'SKILL.md'), 'utf-8')
    // Strip YAML frontmatter — only the body content should be injected into nodes.
    // Without this, the --- blocks either pollute the node body (when appended to existing content)
    // or get absorbed as node metadata like user-invocable/name (when node is empty).
    const parsed: matter.GrayMatterFile<string> = matter(raw)
    return parsed.content.replace(/^\n+/, '')
}

export async function readSkillFileSummary(workflowPath: string): Promise<string> {
    const content: string = await readSkillFile(workflowPath)
    return formatParsedSkillSummary(parseSkillFile(content), workflowPath)
}
