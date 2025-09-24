import os
import shutil
import tempfile
from datetime import datetime

import pytest

from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    MarkdownToTreeConverter,
)
from backend.markdown_tree_manager.markdown_to_tree.markdown_to_tree import (
    load_markdown_tree,
)
from backend.markdown_tree_manager.markdown_tree_ds import Node


class TestMarkdownToTreeConverter:

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for test files"""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)

    @pytest.fixture
    def sample_markdown_files(self, temp_dir):
        """Create sample markdown files for testing"""
        # Root node
        root_content = """---
created_at: '2025-07-28T10:00:00.000000'
modified_at: '2025-07-28T10:00:00.000000'
node_id: 1
title: Root Node
color: green
---
### This is the root node summary

This is the main content of the root node.
It has multiple lines of content.

-----------------
_Links:_
"""
        with open(os.path.join(temp_dir, "1_root_node.md"), 'w') as f:
            f.write(root_content)

        # Child node
        child_content = """---
created_at: '2025-07-28T11:00:00.000000'
modified_at: '2025-07-28T11:00:00.000000'
node_id: 2
title: Child Node
---
### Child node summary

Child node content goes here.

-----------------
_Links:_
Parent:
- is_a_sub_task_of [[1_root_node.md]]
"""
        with open(os.path.join(temp_dir, "2_child_node.md"), 'w') as f:
            f.write(child_content)

        # Grandchild node
        grandchild_content = """---
created_at: '2025-07-28T12:00:00.000000'
modified_at: '2025-07-28T12:00:00.000000'
node_id: 3
title: Grandchild Node
---
### Grandchild summary

More content here.

-----------------
_Links:_
Parent:
- implements [[2_child_node.md]]
"""
        with open(os.path.join(temp_dir, "3_grandchild_node.md"), 'w') as f:
            f.write(grandchild_content)

        return temp_dir

    def test_load_tree_basic(self, sample_markdown_files):
        """Test basic tree loading functionality"""
        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(sample_markdown_files)

        # Check that all nodes were loaded
        assert len(tree_data) == 3
        assert 1 in tree_data
        assert 2 in tree_data
        assert 3 in tree_data

    def test_node_properties(self, sample_markdown_files):
        """Test that node properties are correctly parsed"""
        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(sample_markdown_files)

        # Check root node
        root = tree_data[1]
        assert root.title == "Root Node"
        assert root.summary == "This is the root node summary"
        assert "This is the main content of the root node." in root.content
        assert root.filename == "1_root_node.md"
        assert root.color == "green"
        assert root.parent_id is None

        # Check child node
        child = tree_data[2]
        assert child.title == "Child Node"
        assert child.summary == "Child node summary"
        assert child.parent_id == 1

    def test_relationships(self, sample_markdown_files):
        """Test that relationships are correctly parsed"""
        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(sample_markdown_files)

        # Check parent-child relationships
        root = tree_data[1]
        child = tree_data[2]
        grandchild = tree_data[3]

        assert 2 in root.children
        assert child.parent_id == 1
        assert child.relationships[1] == "is a sub task of"

        assert 3 in child.children
        assert grandchild.parent_id == 2
        assert grandchild.relationships[2] == "implements"

    def test_datetime_parsing(self, sample_markdown_files):
        """Test that datetime fields are correctly parsed"""
        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(sample_markdown_files)

        root = tree_data[1]
        assert isinstance(root.created_at, datetime)
        assert isinstance(root.modified_at, datetime)
        assert root.created_at.year == 2025
        assert root.created_at.month == 7
        assert root.created_at.day == 28

    def test_missing_frontmatter(self, temp_dir):
        """Test handling of files without frontmatter"""
        bad_content = """### Just some content

No frontmatter here!
"""
        with open(os.path.join(temp_dir, "bad_file.md"), 'w') as f:
            f.write(bad_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        # Should load successfully but skip the bad file
        assert len(tree_data) == 0

    def test_invalid_yaml(self, temp_dir):
        """Test handling of invalid YAML frontmatter"""
        bad_yaml = """---
node_id: 1
title: Bad YAML
invalid_yaml: [unclosed bracket
---
### Content
"""
        with open(os.path.join(temp_dir, "bad_yaml.md"), 'w') as f:
            f.write(bad_yaml)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        # Should handle the error gracefully
        assert len(tree_data) == 0

    def test_missing_node_id(self, temp_dir):
        """Test handling of files without node_id"""
        no_id_content = """---
title: No ID Node
created_at: '2025-07-28T10:00:00.000000'
---
### Content without node ID
"""
        with open(os.path.join(temp_dir, "no_id.md"), 'w') as f:
            f.write(no_id_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        # Should skip files without node_id
        assert len(tree_data) == 0

    def test_convenience_function(self, sample_markdown_files):
        """Test the convenience function load_markdown_tree"""
        markdown_tree = load_markdown_tree(sample_markdown_files)

        # Test that it returns a MarkdownTree object
        from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
        assert isinstance(markdown_tree, MarkdownTree)

        # Test that the tree contains the expected nodes
        assert len(markdown_tree.tree) == 3
        assert all(isinstance(node, Node) for node in markdown_tree.tree.values())

    def test_nonexistent_directory(self):
        """Test handling of nonexistent directory"""
        with pytest.raises(ValueError, match="Markdown directory does not exist"):
            converter = MarkdownToTreeConverter()
            converter.load_tree_from_markdown("/nonexistent/path")

    def test_complex_content_parsing(self, temp_dir):
        """Test parsing of complex content with multiple sections"""
        complex_content = """---
node_id: 10
title: Complex Node
---
### Main summary line

First paragraph of content.

Second paragraph with **bold** and *italic* text.

Some code:
```python
def example():
    return "test"
```

Final paragraph.

-----------------
_Links:_
"""
        with open(os.path.join(temp_dir, "complex.md"), 'w') as f:
            f.write(complex_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        node = tree_data[10]
        assert node.summary == "Main summary line"
        assert "First paragraph" in node.content
        assert "def example():" in node.content
        assert "Final paragraph" in node.content

    def test_no_links_section(self, temp_dir):
        """Test parsing of markdown file with no links section"""
        no_links_content = """---
node_id: 1
title: Introduction to VoiceTree and its Founder (1)
---
### Manu, founder of VoiceTree, introduces the inefficiency of current LLMs in simulating memory through brute-force re-processing of chat history.

Hey YC, I'm Manu, the founder of VoiceTree. Today's LLMs essentially simulate memory through brute force: they re-process the whole chat history and context for every single turn, which is inefficient.


-----------------
_Links:_
"""
        with open(os.path.join(temp_dir, "1_introduction.md"), 'w') as f:
            f.write(no_links_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        assert len(tree_data) == 1
        node = tree_data[1]
        assert node.title == "Introduction to VoiceTree and its Founder (1)"
        assert node.summary == "Manu, founder of VoiceTree, introduces the inefficiency of current LLMs in simulating memory through brute-force re-processing of chat history."
        assert "Hey YC, I'm Manu" in node.content
        assert node.parent_id is None
        assert len(node.children) == 0
        assert len(node.relationships) == 0

    def test_no_summary_section(self, temp_dir):
        """Test parsing of markdown file without summary (no ### line)"""
        no_summary_content = """---
node_id: 6
title: Agent in Shared Workspace (6)
---
An agent can be added into the shared workspace, getting the exact context it needs directly from the graph. This makes the interaction cheaper and more accurate, eliminating the need to re-explain any context. The agent's progress is also visible in real-time.


-----------------
_Links:_
Parent:
- describes_the_integration_and_benefits_of_an [[3_Graph_as_Shared_Human-AI_Memory.md]]
"""
        with open(os.path.join(temp_dir, "6_agent_workspace.md"), 'w') as f:
            f.write(no_summary_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        assert len(tree_data) == 1
        node = tree_data[6]
        assert node.title == "Agent in Shared Workspace (6)"
        assert node.summary == ""  # No summary should be empty
        assert "An agent can be added into the shared workspace" in node.content
        assert "The agent's progress is also visible in real-time." in node.content

    def test_complex_content_with_mermaid_diagram(self, temp_dir):
        """Test parsing of markdown file with complex content including mermaid diagrams"""
        complex_mermaid_content = """---
node_id: 6_1
title: Agent-Graph Interaction Flow (6_1)
color: pink
---
```mermaid
graph TD
    A[Human User] --> B[VoiceTree Graph]
    C[Agent] --> B
    B --> D[Shared Context]
    D --> E[Cost-Efficient Queries]
    D --> F[Accurate Responses]
    D --> G[Real-time Progress]

    B --> H[Historical Conversations]
    B --> I[Project Knowledge]
    B --> J[Task Dependencies]

    style A fill:#e1f5fe
    style C fill:#fce4ec
    style B fill:#f3e5f5
    style D fill:#e8f5e8
```

This diagram illustrates how both humans and agents access the same VoiceTree graph, creating a shared workspace where context is preserved and leveraged for more efficient interactions.

-----------------
_Links:_
Parent:
- visualizes [[6_Agent_in_Shared_Workspace.md]]
"""
        with open(os.path.join(temp_dir, "6_1_agent_flow.md"), 'w') as f:
            f.write(complex_mermaid_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        assert len(tree_data) == 1
        node = tree_data[6_1]
        assert node.title == "Agent-Graph Interaction Flow (6_1)"
        assert node.color == "pink"
        assert node.summary == ""  # No ### summary line
        assert "```mermaid" in node.content
        assert "graph TD" in node.content
        assert "A[Human User] --> B[VoiceTree Graph]" in node.content
        assert "style A fill:#e1f5fe" in node.content
        assert "This diagram illustrates how both humans and agents" in node.content

    def test_empty_links_section_vs_no_links(self, temp_dir):
        """Test difference between empty links section and completely missing links"""
        # File with empty links section
        empty_links_content = """---
node_id: 1
title: Empty Links Node
---
### Summary here

Content here.

-----------------
_Links:_
"""

        # File with no links section at all
        no_links_content = """---
node_id: 2
title: No Links Node
---
### Summary here

Content here.
"""

        with open(os.path.join(temp_dir, "1_empty_links.md"), 'w') as f:
            f.write(empty_links_content)
        with open(os.path.join(temp_dir, "2_no_links.md"), 'w') as f:
            f.write(no_links_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        assert len(tree_data) == 2

        # Both should have no relationships
        empty_links_node = tree_data[1]
        no_links_node = tree_data[2]

        assert len(empty_links_node.relationships) == 0
        assert len(no_links_node.relationships) == 0
        assert empty_links_node.parent_id is None
        assert no_links_node.parent_id is None

    def test_mixed_content_types(self, temp_dir):
        """Test parsing files with mixed content types (code, lists, quotes)"""
        mixed_content = """---
node_id: 100
title: Mixed Content Example
---
### This node contains various content types

Here's some regular text.

## A heading

- Bullet point 1
- Bullet point 2
  - Nested bullet

1. Numbered list
2. Second item

> This is a quote block
> with multiple lines

Some inline `code` and a code block:

```python
def process_data(data):
    # Process the input
    result = data.transform()
    return result
```

**Bold text** and *italic text*.

[Link text](https://example.com)

| Table | Header |
|-------|---------|
| Cell 1| Cell 2  |

-----------------
_Links:_
"""
        with open(os.path.join(temp_dir, "100_mixed.md"), 'w') as f:
            f.write(mixed_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        assert len(tree_data) == 1
        node = tree_data[100]
        assert node.title == "Mixed Content Example"
        assert node.summary == "This node contains various content types"

        # Check that various content types are preserved
        assert "## A heading" in node.content
        assert "- Bullet point 1" in node.content
        assert "> This is a quote block" in node.content
        assert "```python" in node.content
        assert "def process_data(data):" in node.content
        assert "**Bold text**" in node.content
        assert "[Link text](https://example.com)" in node.content
        assert "| Table | Header |" in node.content

    def test_multiple_summary_lines(self, temp_dir):
        """Test that only the first ### line is treated as summary"""
        multiple_summary_content = """---
node_id: 200
title: Multiple Summary Test
---
### This is the actual summary

Content starts here.

### This is just a heading in the content

More content after the heading.

-----------------
_Links:_
"""
        with open(os.path.join(temp_dir, "200_multi_summary.md"), 'w') as f:
            f.write(multiple_summary_content)

        converter = MarkdownToTreeConverter()
        tree_data = converter.load_tree_from_markdown(temp_dir)

        assert len(tree_data) == 1
        node = tree_data[200]
        assert node.summary == "This is the actual summary"
        assert "Content starts here." in node.content
        assert "### This is just a heading in the content" in node.content
        assert "More content after the heading." in node.content
