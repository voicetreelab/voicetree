import { promises as fs, Dirent } from 'fs'
import path from 'path'
import os from 'os'
import matter from 'gray-matter'
import { parseSkillFile, formatParsedSkillSummary } from '@/pure/workflows/parseSkillFile'

const WORKFLOWS_DIR: string = path.join(os.homedir(), 'brain', 'workflows')

export interface WorkflowTreeNode {
    name: string;
    path: string;
    hasSkillFile: boolean;
    children: WorkflowTreeNode[];
}

async function buildWorkflowTree(dirPath: string): Promise<WorkflowTreeNode | null> {
    const name: string = path.basename(dirPath)
    let entries: Dirent[]
    try {
        entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
        return null
    }

    let hasSkillFile: boolean = false
    try {
        await fs.access(path.join(dirPath, 'SKILL.md'))
        hasSkillFile = true
    } catch { /* no SKILL.md */ }

    const subdirs: Dirent[] = entries.filter(e => e.isDirectory())
    const childResults: Array<WorkflowTreeNode | null> = await Promise.all(
        subdirs.map(sub => buildWorkflowTree(path.join(dirPath, sub.name)))
    )
    const children: WorkflowTreeNode[] = childResults.filter((c): c is WorkflowTreeNode => c !== null)

    // Prune branches with no SKILL.md anywhere in subtree
    if (!hasSkillFile && children.length === 0) {
        return null
    }

    return { name, path: dirPath, hasSkillFile, children }
}

export async function listWorkflows(): Promise<WorkflowTreeNode[]> {
    let entries: Dirent[]
    try {
        entries = await fs.readdir(WORKFLOWS_DIR, { withFileTypes: true })
    } catch {
        await fs.mkdir(WORKFLOWS_DIR, { recursive: true })
        return []
    }

    const subdirs: Dirent[] = entries.filter(e => e.isDirectory())
    const results: Array<WorkflowTreeNode | null> = await Promise.all(
        subdirs.map(sub => buildWorkflowTree(path.join(WORKFLOWS_DIR, sub.name)))
    )
    return results.filter((r): r is WorkflowTreeNode => r !== null)
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
