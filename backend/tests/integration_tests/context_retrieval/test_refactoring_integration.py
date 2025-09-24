"""
Integration tests for the refactored dependency traversal system.
Tests the integration between markdown_to_tree, context_retrieval, and content_filtering modules.
"""

import tempfile
from pathlib import Path

import pytest

from backend.context_retrieval.content_filtering import ContentLevel
from backend.context_retrieval.content_filtering import apply_content_filter
from backend.context_retrieval.content_filtering import get_neighborhood
from backend.context_retrieval.dependency_traversal import TraversalOptions
from backend.context_retrieval.dependency_traversal import traverse_to_node
from backend.markdown_tree_manager.markdown_to_tree.node_loader import load_node


class TestRefactoringIntegration:
    """Test suite for the integrated refactored modules"""

    @pytest.fixture
    def sample_tree(self):
        """Create a sample markdown tree for testing"""
        temp_dir = tempfile.mkdtemp()
        markdown_dir = Path(temp_dir)

        # Create a simple tree structure
        # Root node
        root_content = """---
node_id: 1
title: Root Node
---
### This is the root of our tree

Content for the root node.

_Links:_
"""
        (markdown_dir / "1_Root.md").write_text(root_content)

        # Parent node
        parent_content = """---
node_id: 2
title: Parent Node
---
### This is a parent node

Parent content here.

_Links:_
Parent:
- is_child_of [[1_Root.md]]
"""
        (markdown_dir / "2_Parent.md").write_text(parent_content)

        # Target node
        target_content = """---
node_id: 3
title: Target Node
---
### This is our target node for testing

Target node content with important information.

_Links:_
Parent:
- is_child_of [[2_Parent.md]]
"""
        (markdown_dir / "3_Target.md").write_text(target_content)

        # Child node
        child_content = """---
node_id: 4
title: Child Node
---
### This is a child node

Child content here.

_Links:_
Parent:
- is_child_of [[3_Target.md]]
"""
        (markdown_dir / "4_Child.md").write_text(child_content)

        # Sibling node
        sibling_content = """---
node_id: 5
title: Sibling Node
---
### This is a sibling node

Sibling content.

_Links:_
Parent:
- is_child_of [[2_Parent.md]]
"""
        (markdown_dir / "5_Sibling.md").write_text(sibling_content)

        return markdown_dir

    def test_load_node_integration(self, sample_tree):
        """Test that load_node correctly loads a markdown file"""
        result = load_node("3_Target.md", sample_tree)

        assert result['node_id'] == '3'
        assert result['title'] == 'Target Node'
        assert result['summary'] == 'This is our target node for testing'
        assert '2_Parent.md' in result['links']
        assert 'important information' in result['content']

    def test_traverse_to_node_integration(self, sample_tree):
        """Test that traverse_to_node correctly traverses the tree"""
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=5
        )

        result = traverse_to_node("3_Target.md", sample_tree, options)

        # Should have root, parent, target, and child
        assert len(result) >= 4

        # Check that we have the expected nodes
        node_ids = [node.get('node_id', '') for node in result]
        assert '1' in node_ids  # Root
        assert '2' in node_ids  # Parent
        assert '3' in node_ids  # Target
        assert '4' in node_ids  # Child

    def test_content_filtering_integration(self, sample_tree):
        """Test that content filtering works with traversal output"""
        # First get nodes from traversal
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            max_depth=5
        )
        nodes = traverse_to_node("3_Target.md", sample_tree, options)

        # Add distance information (simulate what would be calculated)
        for node in nodes:
            if node.get('node_id') == '3':
                node['distance_from_target'] = 0
            elif node.get('node_id') in ['2', '4']:
                node['distance_from_target'] = 1
            elif node.get('node_id') == '1':
                node['distance_from_target'] = 2
            else:
                node['distance_from_target'] = 3

        # Apply content filtering
        filtered = apply_content_filter(nodes, ContentLevel.TITLES_AND_SUMMARIES)

        # Check that filtering worked correctly
        # In TITLES_AND_SUMMARIES mode, all nodes should have titles and summaries but no content
        for node in filtered:
            assert node.get('title'), f"Node {node.get('node_id')} should have title"
            assert node.get('summary') is not None, f"Node {node.get('node_id')} should have summary"
            assert node.get('content') is None, f"Node {node.get('node_id')} should not have content in TITLES_AND_SUMMARIES mode"

    def test_neighborhood_finding_integration(self, sample_tree):
        """Test that neighborhood finding works correctly"""
        # Build connections dictionary for all nodes
        connections = {}
        import re

        for md_file in sample_tree.glob("*.md"):
            filename = md_file.name
            content = md_file.read_text()

            # Extract links from this file
            pattern = r'\[\[([^\]|]+\.md)(?:\|[^\|]+)?\]\]'
            links = re.findall(pattern, content)

            if filename not in connections:
                connections[filename] = []
            connections[filename].extend(links)

            # Also add reverse connections (files that this file links to should know about it)
            for link in links:
                if link not in connections:
                    connections[link] = []
                if filename not in connections[link]:
                    connections[link].append(filename)

        # Define load_node function for the test
        def test_load_node(filename):
            filepath = sample_tree / filename
            content = filepath.read_text()
            # Simple extraction for test
            node_id_match = re.search(r'node_id:\s*(\d+)', content)
            title_match = re.search(r'title:\s*(.+)', content)
            return {
                'filename': filename,
                'node_id': node_id_match.group(1) if node_id_match else None,
                'title': title_match.group(1) if title_match else None,
                'content': content
            }

        # Get neighborhood around target using the correct API
        neighbors = get_neighborhood("3_Target.md", connections, radius=1,
                                    load_node_func=test_load_node)

        # Should find parent, child, and sibling (all at distance 1)
        assert len(neighbors) >= 2  # At least parent and child

        # Check that distances are correct
        for neighbor in neighbors:
            assert neighbor['distance_from_target'] == 1

    def test_full_pipeline_integration(self, sample_tree):
        """Test the complete pipeline from loading to filtering"""
        # Step 1: Load the target node
        target = load_node("3_Target.md", sample_tree)
        assert target['node_id'] == '3'

        # Step 2: Traverse to get context
        options = TraversalOptions(
            include_parents=True,
            include_children=True,
            include_neighborhood=False,  # Simplified for this test
            max_depth=3,
            content_level=ContentLevel.TITLES_ONLY
        )

        context_nodes = traverse_to_node("3_Target.md", sample_tree, options)

        # Step 3: Verify we have a proper tree structure
        assert len(context_nodes) >= 3  # At minimum: root, parent, target

        # Step 4: Verify content levels are appropriate
        # With TITLES_ONLY, we should have minimal content
        for node in context_nodes:
            if hasattr(options, 'content_level') and options.content_level == ContentLevel.TITLES_ONLY:
                # In production, this would be filtered more aggressively
                assert 'title' in node or 'filename' in node

        print(f"Integration test complete: processed {len(context_nodes)} nodes")

    def test_max_depth_respected(self, sample_tree):
        """Test that max_depth is properly respected in traversal"""
        options = TraversalOptions(
            include_parents=True,
            include_children=False,
            max_depth=1  # Should only go 1 level up
        )

        result = traverse_to_node("3_Target.md", sample_tree, options)

        # With max_depth=1, should have target and immediate parent only
        node_ids = [node.get('node_id', '') for node in result]
        assert '3' in node_ids  # Target
        assert '2' in node_ids  # Parent
        assert '1' not in node_ids  # Root should be excluded (too far)
