import os
import tempfile
import shutil
import pytest

from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_repository_for_themes
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node


class TestThemeTreeLoader:
    
    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for test files"""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def input_forest_with_colors(self, temp_dir):
        """Create input_forest directory with markdown files containing color metadata"""
        # Create input_forest subdirectory
        input_forest = os.path.join(temp_dir, "input_forest")
        os.makedirs(input_forest)
        
        # Node with green color
        node1_content = """---
created_at: '2025-08-04T10:00:00.000000'
modified_at: '2025-08-04T10:00:00.000000'
node_id: 1
title: Project Overview
color: green
---
### Main project documentation and architecture overview

This node contains the core project documentation.
It describes the overall system architecture.

-----------------
_Links:_
"""
        with open(os.path.join(input_forest, "1_project_overview.md"), 'w') as f:
            f.write(node1_content)
        
        # Node with blue color
        node2_content = """---
created_at: '2025-08-04T11:00:00.000000'
modified_at: '2025-08-04T11:00:00.000000'
node_id: 2
title: API Design
color: blue
---
### REST API endpoints and specifications

Detailed API documentation for all endpoints.
Includes authentication and error handling.

-----------------
_Links:_
Parent:
- is_a_component_of [[1_project_overview.md]]
"""
        with open(os.path.join(input_forest, "2_api_design.md"), 'w') as f:
            f.write(node2_content)
        
        # Node with red color
        node3_content = """---
created_at: '2025-08-04T12:00:00.000000'
modified_at: '2025-08-04T12:00:00.000000'
node_id: 3
title: Testing Strategy
color: red
---
### Comprehensive testing approach for quality assurance

Unit tests, integration tests, and end-to-end testing.

-----------------
_Links:_
Parent:
- supports [[1_project_overview.md]]
"""
        with open(os.path.join(input_forest, "3_testing_strategy.md"), 'w') as f:
            f.write(node3_content)
        
        return input_forest
    
    def test_loads_repository_and_strips_colors(self, input_forest_with_colors):
        """Test that the function loads the repository and removes all color metadata"""
        # Call the function to load and strip colors
        tree_data = load_markdown_repository_for_themes(input_forest_with_colors)
        
        # Verify all nodes were loaded
        assert len(tree_data) == 3
        assert 1 in tree_data
        assert 2 in tree_data
        assert 3 in tree_data
        
        # Verify all nodes are Node objects
        for node in tree_data.values():
            assert isinstance(node, Node)
        
        # Verify all color metadata is stripped/set to None
        for node_id, node in tree_data.items():
            assert not hasattr(node, 'color') or node.color is None, f"Node {node_id} still has color: {getattr(node, 'color', 'no attr')}"
        
        # Verify other metadata is preserved
        node1 = tree_data[1]
        assert node1.title == "Project Overview"
        assert node1.summary == "Main project documentation and architecture overview"
        assert "core project documentation" in node1.content
        
        node2 = tree_data[2]
        assert node2.title == "API Design"
        assert node2.summary == "REST API endpoints and specifications"
        assert node2.parent_id == 1
        
        node3 = tree_data[3]
        assert node3.title == "Testing Strategy"  
        assert node3.summary == "Comprehensive testing approach for quality assurance"
        assert node3.parent_id == 1
        
        # Verify relationships are preserved
        assert 2 in tree_data[1].children
        assert 3 in tree_data[1].children
        assert tree_data[2].relationships[1] == "is a component of"
        assert tree_data[3].relationships[1] == "supports"
    
    def test_handles_nodes_without_colors(self, temp_dir):
        """Test that function works correctly with nodes that have no color metadata"""
        input_forest = os.path.join(temp_dir, "input_forest")
        os.makedirs(input_forest)
        
        # Node without color field
        node_content = """---
created_at: '2025-08-04T10:00:00.000000'
modified_at: '2025-08-04T10:00:00.000000'
node_id: 1
title: No Color Node
---
### Node without any color metadata

This node has no color field in the YAML frontmatter.

-----------------
_Links:_
"""
        with open(os.path.join(input_forest, "1_no_color.md"), 'w') as f:
            f.write(node_content)
        
        tree_data = load_markdown_repository_for_themes(input_forest)
        
        assert len(tree_data) == 1
        node = tree_data[1]
        assert node.title == "No Color Node"
        assert not hasattr(node, 'color') or node.color is None
    
    def test_nonexistent_directory(self):
        """Test handling of nonexistent input_forest directory"""
        with pytest.raises(ValueError, match="Markdown directory does not exist"):
            load_markdown_repository_for_themes("/nonexistent/input_forest")