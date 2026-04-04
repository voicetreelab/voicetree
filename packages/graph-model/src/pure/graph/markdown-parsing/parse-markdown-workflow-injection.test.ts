import { describe, it, expect } from 'vitest'
import { parseMarkdownToGraphNode } from './'
import type { Graph, GraphNode } from '..'
import { createGraph } from '../createGraph'

const emptyGraph: Graph = createGraph({})

describe('workflow SKILL.md injection through parseMarkdownToGraphNode', () => {
    it('should preserve full SKILL.md body when appended to existing node content', () => {
        const skillBody: string = `Skill path = /home/user/workflows/example_feature

# Example Feature Skill

This skill implements example features.

Required:
{{FEATURE_SPEC}}
The specification of the feature
string

{{INTERNAL_TERMS}}
Internal terms used in the project
string

Optional:
{{DOCUMENTATION=true}}
Whether to generate docs
boolean

{{DEPTH=2}}
Analysis depth level
integer

{{STYLE=concise}}
Writing style
string`

        const existing: string = '# My Node'
        const appended: string = `${existing}\n\n${skillBody}`

        const result: GraphNode = parseMarkdownToGraphNode(appended, '/abs/path/test.md', emptyGraph)

        expect(result.contentWithoutYamlOrLinks).toBe(appended)
        expect(result.contentWithoutYamlOrLinks).toContain('{{FEATURE_SPEC}}')
        expect(result.contentWithoutYamlOrLinks).toContain('{{STYLE=concise}}')
        expect(result.contentWithoutYamlOrLinks).toContain('Required:')
        expect(result.contentWithoutYamlOrLinks).toContain('Optional:')
        expect(result.contentWithoutYamlOrLinks).toContain('Skill path = /home/user/workflows/example_feature')
    })

    it('should preserve full SKILL.md body when node is empty', () => {
        const skillBody: string = `# Domain Explorer — Evolutionary Cycle

You explore a specific business decision area.

## Step 1: Generate 10 Candidates
Brainstorm 10 specific business scenarios.`

        const result: GraphNode = parseMarkdownToGraphNode(skillBody, '/abs/path/test.md', emptyGraph)

        expect(result.contentWithoutYamlOrLinks).toBe(skillBody)
        expect(result.contentWithoutYamlOrLinks).toContain('## Step 1: Generate 10 Candidates')
        expect(result.contentWithoutYamlOrLinks).toContain('Brainstorm 10 specific business scenarios.')
    })

    it('should handle --- separators in body without losing content', () => {
        const contentWithDashes: string = `# My Node

---
name: some-skill
---

# Skill Title

Body content here`

        const result: GraphNode = parseMarkdownToGraphNode(contentWithDashes, '/abs/path/test.md', emptyGraph)

        expect(result.contentWithoutYamlOrLinks).toBe(contentWithDashes)
        expect(result.contentWithoutYamlOrLinks).toContain('Body content here')
    })
})
