"""
Behavioral test for the markdown_to_tree.load_node function.
Tests the input/output behavior of the load_node function with real markdown files.
"""

import os
import tempfile
import shutil
from pathlib import Path
import pytest

from backend.markdown_to_tree.node_loader import load_node


class TestLoadNodeFunction:
    
    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for test files"""
        temp_dir = Path(tempfile.mkdtemp())
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def sample_markdown_file(self, temp_dir):
        """Create a sample markdown file for testing"""
        content = """---
node_id: 20
title: Dependency Traversal for Relevant Nodes
color: blue
agent_name: TestBot
---
### Performs an MVP dependency traversal to find the most relevant nodes using TF-IDF

This system traverses the graph following parent dependencies and accumulates content to provide context for LLM queries. The traversal includes both parent and child relationships to build comprehensive context.

The implementation uses cosine similarity with TF-IDF vectors to find the most relevant unvisited nodes.

-----------------
_Links:_
Parent:
- implements [[19_Implement_Vector_Search.md]]
Children:
- enables [[21_Context_Accumulation_Strategy.md]]
"""
        
        filename = "20_Dependency_Traversal.md"
        filepath = temp_dir / filename
        filepath.write_text(content)
        
        return filename, temp_dir
    
    def test_load_node_basic_functionality(self, sample_markdown_file):
        """Test basic load_node functionality with a complete markdown file"""
        filename, markdown_dir = sample_markdown_file
        
        # Call the function under test
        result = load_node(filename, markdown_dir)
        
        # Verify the output structure and content
        assert isinstance(result, dict)
        assert set(result.keys()) == {'filename', 'node_id', 'title', 'summary', 'content', 'links'}
        
        # Verify specific values
        assert result['filename'] == '20_Dependency_Traversal.md'
        assert result['node_id'] == '20'
        assert result['title'] == 'Dependency Traversal for Relevant Nodes'
        assert result['summary'] == 'Performs an MVP dependency traversal to find the most relevant nodes using TF-IDF'
        assert 'This system traverses the graph' in result['content']
        assert '---' in result['content']  # Should contain full original content
        
        # Verify links extraction
        assert 'links' in result
        assert '19_Implement_Vector_Search.md' in result['links']
        assert '21_Context_Accumulation_Strategy.md' in result['links']
    
    def test_load_node_nonexistent_file(self, temp_dir):
        """Test load_node behavior with a file that doesn't exist"""
        result = load_node('nonexistent.md', temp_dir)
        
        # Should return empty structure but not fail
        assert result['filename'] == 'nonexistent.md'
        assert result['node_id'] == ''
        assert result['title'] == ''
        assert result['summary'] == ''
        assert result['content'] == ''
        assert result['links'] == []
    
    def test_load_node_minimal_file(self, temp_dir):
        """Test load_node with a minimal markdown file"""
        minimal_content = """---
node_id: 1
title: Simple Node
---
### Basic summary

Just some content."""
        
        filename = "1_simple.md"
        filepath = temp_dir / filename
        filepath.write_text(minimal_content)
        
        result = load_node(filename, temp_dir)
        
        assert result['filename'] == '1_simple.md'
        assert result['node_id'] == '1'
        assert result['title'] == 'Simple Node'
        assert result['summary'] == 'Basic summary'
        assert result['content'] == minimal_content
    
    def test_load_node_no_frontmatter(self, temp_dir):
        """Test load_node with file without frontmatter"""
        no_frontmatter_content = """# Just a heading

Some content without frontmatter."""
        
        filename = "no_frontmatter.md"
        filepath = temp_dir / filename
        filepath.write_text(no_frontmatter_content)
        
        result = load_node(filename, temp_dir)
        
        # Should still return structure but with limited parsing
        assert result['filename'] == 'no_frontmatter.md'
        assert result['node_id'] == ''  # No frontmatter
        assert result['title'] == 'Just a heading'  # Should fallback to # heading
        assert result['summary'] == ''  # No ### summary
        assert result['content'] == no_frontmatter_content
    
    def test_load_node_no_summary_heading(self, temp_dir):
        """Test load_node with file that has no ### summary heading"""
        no_summary_content = """---
node_id: 5
title: No Summary Node
---

Just content without a summary heading."""
        
        filename = "5_no_summary.md"
        filepath = temp_dir / filename
        filepath.write_text(no_summary_content)
        
        result = load_node(filename, temp_dir)
        
        assert result['filename'] == '5_no_summary.md'
        assert result['node_id'] == '5'
        assert result['title'] == 'No Summary Node'
        assert result['summary'] == ''  # Should be empty when no summary
        assert result['content'] == no_summary_content