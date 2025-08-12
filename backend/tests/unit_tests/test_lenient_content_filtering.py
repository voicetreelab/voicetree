#!/usr/bin/env python3
"""
Test for lenient content filtering with new thresholds:
- Distance 0-5: full content
- Distance 6-12: titles + summaries  
- Distance > 12: titles only
"""

import pytest
from pathlib import Path
import tempfile
import shutil
from backend.context_retrieval.dependency_traversal import (
    traverse_to_node,
    TraversalOptions,
    ContentLevel
)


class TestLenientContentFiltering:
    """Test the new lenient content filtering thresholds."""
    
    @pytest.fixture
    def deep_markdown_tree(self):
        """Create a deep tree structure for testing distance-based filtering."""
        temp_dir = tempfile.mkdtemp()
        markdown_dir = Path(temp_dir) / "test_vault"
        markdown_dir.mkdir()
        
        # Create a chain of 15 nodes for testing different distance thresholds
        for i in range(15):
            content = f"""---
node_id: {i}
title: Node {i}
---
### Summary for node {i}

This is the full content for node {i}.
More detailed information here."""
            
            # Add parent link except for root
            if i > 0:
                content += f"\n\nis_enabled_by [[{i-1}_Node.md]]"
            
            (markdown_dir / f"{i}_Node.md").write_text(content)
        
        yield markdown_dir
        
        # Cleanup
        shutil.rmtree(temp_dir)
    
    def test_close_nodes_have_full_content(self, deep_markdown_tree):
        """Test that nodes at distance 0-5 have full content."""
        options = TraversalOptions(
            include_parents=True,
            include_children=False,
            max_depth=15,
            content_level=ContentLevel.FULL_CONTENT
        )
        
        # Start from node 5 (will have parents at distances 0-5)
        nodes = traverse_to_node("5_Node.md", deep_markdown_tree, options)
        
        # Check nodes at different distances
        for node in nodes:
            distance = node.get('distance_from_target', node.get('depth', 0))
            
            if distance <= 5:
                # Should have full content
                assert 'content' in node and node['content'], f"Node at distance {distance} should have content"
                assert 'This is the full content' in node['content']
    
    def test_medium_nodes_have_summaries_only(self, deep_markdown_tree):
        """Test that nodes at distance 6-12 have titles and summaries but no content."""
        options = TraversalOptions(
            include_parents=True,
            include_children=False,
            max_depth=15,
            content_level=ContentLevel.FULL_CONTENT
        )
        
        # Start from node 14 (will have parents at various distances)
        nodes = traverse_to_node("14_Node.md", deep_markdown_tree, options)
        
        # Debug: print what we got
        for node in nodes:
            dist = node.get('distance_from_target', node.get('depth', 0))
            has_content = 'content' in node and node['content'] is not None
            print(f"Node at distance {dist}: has_content={has_content}")
        
        for node in nodes:
            distance = node.get('distance_from_target', node.get('depth', 0))
            
            if 6 <= distance <= 12:
                # Should have title but content should be None
                assert 'title' in node and node['title'], f"Node at distance {distance} should have title"
                # Check that content was filtered out
                assert node.get('content') is None, f"Node at distance {distance} should have content=None, but got: {node.get('content')[:50] if node.get('content') else 'None'}"
    
    def test_far_nodes_have_titles_only(self, deep_markdown_tree):
        """Test that nodes at distance > 12 have only titles."""
        options = TraversalOptions(
            include_parents=True,
            include_children=False,
            max_depth=15,
            content_level=ContentLevel.FULL_CONTENT
        )
        
        # Start from node 14 (node 0 will be at distance 14)
        nodes = traverse_to_node("14_Node.md", deep_markdown_tree, options)
        
        for node in nodes:
            distance = node.get('distance_from_target', node.get('depth', 0))
            
            if distance > 12:
                # Should have only title
                assert 'title' in node and node['title'], f"Node at distance {distance} should have title"
                if 'summary' in node:
                    assert node['summary'] is None, f"Node at distance {distance} should have summary=None"
                if 'content' in node:
                    assert node['content'] is None, f"Node at distance {distance} should have content=None"
    
    def test_lenient_thresholds_include_more_content(self, deep_markdown_tree):
        """Verify that the new thresholds are more lenient than the old ones."""
        options = TraversalOptions(
            include_parents=True,
            include_children=False,
            max_depth=15,
            content_level=ContentLevel.FULL_CONTENT
        )
        
        nodes = traverse_to_node("10_Node.md", deep_markdown_tree, options)
        
        # Count nodes with different content levels
        full_content_count = sum(1 for n in nodes if n.get('content') and n['content'])
        summary_count = sum(1 for n in nodes if n.get('summary') or (not n.get('content')))
        
        # With our lenient thresholds, nodes 5-10 (6 nodes) should have full content
        # This is much more than the old threshold where only 0-1 would have full content
        assert full_content_count >= 6, f"Should have at least 6 nodes with full content, got {full_content_count}"
        
        print(f"Full content nodes: {full_content_count}")
        print(f"Summary-only nodes: {summary_count}")
        print(f"Total nodes: {len(nodes)}")