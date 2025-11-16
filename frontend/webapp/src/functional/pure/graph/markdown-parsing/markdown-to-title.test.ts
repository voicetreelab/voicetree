import { describe, it, expect } from 'vitest'
import { markdownToTitle } from './markdown-to-title.ts'
import { extractFrontmatter } from './extract-frontmatter.ts'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphNode } from '@/functional/pure/graph/types.ts'

describe('markdownToTitle', () => {
    describe('Frontmatter title priority', () => {
        it('should extract title from frontmatter', () => {
            const node: GraphNode = {
                relativeFilePathIsID: '3.md',
                content: `---
node_id: 3
title: 'Bug: Auto-open Markdown Editor (3)'
---
# Some Heading

Content here`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Bug: Auto-open Markdown Editor (3)')
        })

        it('should handle frontmatter title without quotes', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'test.md',
                content: `---
title: Simple Title
---
Content`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Simple Title')
        })

        it('should handle frontmatter title with double quotes', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'test.md',
                content: `---
title: "Title With Double Quotes"
---
Content`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Title With Double Quotes')
        })

        it('should handle frontmatter title with apostrophes inside double quotes', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'test.md',
                content: `---
title: "It's a Title with Apostrophe's"
---
Content`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe("It's a Title with Apostrophe's")
        })

        it('should handle frontmatter title with special characters', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'test.md',
                content: `---
title: "Special: Characters! & Symbols?"
---
Content`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Special: Characters! & Symbols?')
        })

        it('should prioritize frontmatter title over heading', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'test.md',
                content: `---
title: Frontmatter Title
---
# Heading Title

Content`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Frontmatter Title')
        })

        it('should prioritize frontmatter title over ### heading', () => {
            const node: GraphNode = {
                relativeFilePathIsID: '3.md',
                content: `---
node_id: 3
title: 'Bug: Auto-open Markdown Editor (3)'
---
### The manual editor's auto-open Markdown editor functionality is not working when creating new child nodes.

Content`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Bug: Auto-open Markdown Editor (3)')
        })
    })

    describe('Heading fallback', () => {
        it('should extract title from first heading when no frontmatter title', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'test.md',
                content: `# My Heading

Content here`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('My Heading')
        })

        it('should extract title from heading even with frontmatter but no title field', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'test.md',
                content: `---
color: red
---
# Heading Title

Content`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Heading Title')
        })
    })

    describe('Filename fallback', () => {
        it('should use filename when no frontmatter title or heading', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'my-test_file.md',
                content: 'Just content, no heading',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('my test file')
        })

        it('should clean up underscores and dashes in filename', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'folder/another_folder/test-file_name.md',
                content: 'Content',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('test file name')
        })
    })

    describe('Regression: Real-world content from production', () => {
        it('should extract title from production frontmatter with node_id and position', () => {
            const node: GraphNode = {
                relativeFilePathIsID: '12_Manually_Creating_Task_Tree_Nodes',
                content: `---
node_id: 12
title: Manually Creating Task Tree Nodes (12)
---
### Users can manually create nodes in the task tree.

Users can manually create nodes in the task tree, often preferred over speaking.`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Manually Creating Task Tree Nodes (12)')
        })

        it('should extract title from frontmatter with quoted value', () => {
            const node: GraphNode = {
                relativeFilePathIsID: '9_Ethical_Concern_Objectifying_Colleagues',
                content: `---
node_id: 9
title: "Ethical Concern: Objectifying Colleagues (9)"
position:
  x: 1153.2814824381885
  y: -653.281482438188
---
### Raises an ethical concern about the objectification of colleagues.`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('Ethical Concern: Objectifying Colleagues (9)')
        })
    })

    describe('Edge cases', () => {
        it('should handle empty content', () => {
            const node: GraphNode = {
                relativeFilePathIsID: 'empty.md',
                content: '',
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('empty')
        })

        it('should handle very long heading by skipping it', () => {
            const longHeading = 'a'.repeat(150)
            const node: GraphNode = {
                relativeFilePathIsID: 'test-file.md',
                content: `# ${longHeading}`,
                outgoingEdges: [],
                nodeUIMetadata: {
                    title: '',
                    color: O.none,
                    position: O.none
                }
            }

            const frontmatter = extractFrontmatter(node.content)
            const title = markdownToTitle(frontmatter, node.content, node.relativeFilePathIsID)
            expect(title).toBe('test file') // Should fall back to filename
        })
    })
})
