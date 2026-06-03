// Workflow / skill reader — the single source of truth for listing the user's
// `~/brain/workflows` skill tree and reading individual SKILL.md files.
//
// Lives in vt-daemon because it is host-filesystem I/O: the Electron main
// process imports these directly, and the browser adapter reaches them over the
// `workflows.*` JSON-RPC routes (workflowRoutes.ts) so browser-mode gets the
// same workflow-injection feature without a renderer filesystem.
//
// `os.homedir()` resolution is the only impurity bound to a fixed location;
// `listWorkflowsIn` / `readSkillFileIn` take the directory explicitly so the
// tree-building and skill-parsing logic is black-box testable against a tmp dir.

import {promises as fs, type Dirent} from 'fs'
import path from 'path'
import os from 'os'
import {parseSkillFile, formatParsedSkillSummary} from '@vt/graph-model/workflows'

export interface WorkflowTreeNode {
    name: string
    path: string
    hasSkillFile: boolean
    children: WorkflowTreeNode[]
}

function workflowsRoot(): string {
    return path.join(os.homedir(), 'brain', 'workflows')
}

// Strip a leading YAML frontmatter block. SKILL.md bodies are injected verbatim
// into nodes, so the `---` delimiters and `key: value` lines must not pollute
// the node body (or, on an empty node, get absorbed as node metadata). A
// standard leading `---\n…\n---` block is the only shape SKILL files use, so a
// pure delimiter match is sufficient — no gray-matter dependency in the daemon.
function stripFrontmatter(raw: string): string {
    const match: RegExpMatchArray | null = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
    const body: string = match ? raw.slice(match[0].length) : raw
    return body.replace(/^\n+/, '')
}

async function buildWorkflowTree(dirPath: string): Promise<WorkflowTreeNode | null> {
    const name: string = path.basename(dirPath)
    let entries: Dirent[]
    try {
        entries = await fs.readdir(dirPath, {withFileTypes: true})
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
        subdirs.map(sub => buildWorkflowTree(path.join(dirPath, sub.name))),
    )
    const children: WorkflowTreeNode[] = childResults.filter((c): c is WorkflowTreeNode => c !== null)

    // Prune branches with no SKILL.md anywhere in the subtree.
    if (!hasSkillFile && children.length === 0) return null

    return {name, path: dirPath, hasSkillFile, children}
}

/** List the workflow tree rooted at an explicit directory (testable core). */
export async function listWorkflowsIn(rootDir: string): Promise<WorkflowTreeNode[]> {
    let entries: Dirent[]
    try {
        entries = await fs.readdir(rootDir, {withFileTypes: true})
    } catch {
        await fs.mkdir(rootDir, {recursive: true})
        return []
    }

    const subdirs: Dirent[] = entries.filter(e => e.isDirectory())
    const results: Array<WorkflowTreeNode | null> = await Promise.all(
        subdirs.map(sub => buildWorkflowTree(path.join(rootDir, sub.name))),
    )
    return results.filter((r): r is WorkflowTreeNode => r !== null)
}

/** Read a SKILL.md body (frontmatter stripped) from an explicit workflow dir. */
export async function readSkillFile(workflowPath: string): Promise<string> {
    const raw: string = await fs.readFile(path.join(workflowPath, 'SKILL.md'), 'utf-8')
    return stripFrontmatter(raw)
}

/** Read + parse a SKILL.md into the compact injectable summary. */
export async function readSkillFileSummary(workflowPath: string): Promise<string> {
    const content: string = await readSkillFile(workflowPath)
    const skillFilePath: string = workflowPath.replace(os.homedir() + '/brain/', '~/brain/') + '/SKILL.md'
    return formatParsedSkillSummary(parseSkillFile(content), skillFilePath)
}

/** List the user's `~/brain/workflows` tree (host-home rooted). */
export function listWorkflows(): Promise<WorkflowTreeNode[]> {
    return listWorkflowsIn(workflowsRoot())
}
