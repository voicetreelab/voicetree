import os
import tempfile
import shutil
from datetime import datetime
import pytest

from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import MarkdownToTreeConverter, load_markdown_tree
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node


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
        tree_data = load_markdown_tree(sample_markdown_files)
        
        assert len(tree_data) == 3
        assert all(isinstance(node, Node) for node in tree_data.values())
    
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