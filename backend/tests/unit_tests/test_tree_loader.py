"""
Tests for TreeLoader - behavioral tests for loading markdown tree structures
"""

import pytest
import tempfile
import os
from pathlib import Path

from backend.text_to_graph_pipeline.tree_manager.tree_loader import TreeLoader


class TestTreeLoader:
    """Behavioral tests for TreeLoader component"""
    
    def test_load_single_tree_basic_functionality(self):
        """Test loading a single tree with basic node structure"""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Create test tree directory
            tree_dir = Path(temp_dir) / "2025-08-02_20250802_150743"
            tree_dir.mkdir()
            
            # Create test markdown files
            node1_content = """---
node_id: 1
title: Demo Completion Goal (1)
---
### The demo has been recorded and completed; video check is done.

The demo has been recorded and completed. The video check for the demo was also completed.

-----------------
_Links:_
"""
            
            node2_content = """---
node_id: 2
title: Verify VoiceTree Functionality (2)
---
### Verify VoiceTree is working as the first step for the demo.

The first step for the demo is to ensure that VoiceTree is working correctly.

-----------------
_Links:_
Parent:
- is_a_prerequisite_for_the [[1_Demo_Completion_Goal.md]]
"""
            
            # Write test files
            (tree_dir / "1_Demo_Completion_Goal.md").write_text(node1_content)
            (tree_dir / "2_Verify_VoiceTree_Functionality.md").write_text(node2_content)
            
            # Test the loader
            loader = TreeLoader()
            result = loader.load_single_tree(str(tree_dir))
            
            # Verify structure
            assert "trees" in result
            assert len(result["trees"]) == 1
            
            tree = result["trees"][0]
            assert tree.tree_id == "2025-08-02_20250802_150743"
            assert len(tree.nodes) == 2
            
            # Check node 1
            node1 = next(n for n in tree.nodes if n.node_id == "1")
            assert node1.title == "Demo Completion Goal (1)"
            assert "demo has been recorded" in node1.content.lower()
            assert len(node1.links) == 0
            
            # Check node 2  
            node2 = next(n for n in tree.nodes if n.node_id == "2")
            assert node2.title == "Verify VoiceTree Functionality (2)"
            assert "verify voicetree is working" in node2.content.lower()
            assert "1_Demo_Completion_Goal" in node2.links
    
    def test_load_forest_multiple_trees(self):
        """Test loading multiple trees from a forest directory"""
        with tempfile.TemporaryDirectory() as temp_dir:
            forest_dir = Path(temp_dir)
            
            # Create multiple tree directories
            tree1_dir = forest_dir / "2025-08-02_20250802_150743"
            tree2_dir = forest_dir / "2025-08-03"
            tree1_dir.mkdir()
            tree2_dir.mkdir()
            
            # Create a file in each tree
            (tree1_dir / "1_Node.md").write_text("""---
node_id: 1
title: Node 1
---
Content 1""")
            
            (tree2_dir / "2_Node.md").write_text("""---
node_id: 2  
title: Node 2
---
Content 2""")
            
            # Test forest loading
            loader = TreeLoader()
            result = loader.load_forest(str(forest_dir))
            
            # Verify structure
            assert "trees" in result
            assert len(result["trees"]) == 2
            
            tree_ids = [tree.tree_id for tree in result["trees"]]
            assert "2025-08-02_20250802_150743" in tree_ids
            assert "2025-08-03" in tree_ids
    
    def test_link_extraction(self):
        """Test extraction of markdown links from content"""
        with tempfile.TemporaryDirectory() as temp_dir:
            tree_dir = Path(temp_dir) / "2025-08-03"
            tree_dir.mkdir()
            
            node_content = """---
node_id: 3
title: Test Node
---
This node links to [[parent_node.md]] and [[sibling_node]] and [[another_link.md]].

Also references [[unlinked_node]].
"""
            
            (tree_dir / "3_Test_Node.md").write_text(node_content)
            
            loader = TreeLoader()
            result = loader.load_single_tree(str(tree_dir))
            
            node = result["trees"][0].nodes[0]
            expected_links = ["parent_node", "sibling_node", "another_link", "unlinked_node"]
            assert sorted(node.links) == sorted(expected_links)
    
    def test_invalid_yaml_frontmatter(self):
        """Test handling of files with invalid YAML frontmatter"""
        with tempfile.TemporaryDirectory() as temp_dir:
            tree_dir = Path(temp_dir) / "2025-08-03"
            tree_dir.mkdir()
            
            # Create file with invalid YAML
            invalid_content = """---
node_id: 1
title: "Unclosed quote
---
Content"""
            
            valid_content = """---
node_id: 2
title: Valid Node
---
Valid content"""
            
            (tree_dir / "invalid.md").write_text(invalid_content)
            (tree_dir / "valid.md").write_text(valid_content)
            
            loader = TreeLoader()
            result = loader.load_single_tree(str(tree_dir))
            
            # Should only load the valid file
            assert len(result["trees"][0].nodes) == 1
            assert result["trees"][0].nodes[0].node_id == "2"
    
    def test_missing_node_id(self):
        """Test handling of files without node_id in frontmatter"""
        with tempfile.TemporaryDirectory() as temp_dir:
            tree_dir = Path(temp_dir) / "2025-08-03"
            tree_dir.mkdir()
            
            no_id_content = """---
title: No ID Node
---
Content without node_id"""
            
            valid_content = """---
node_id: 1
title: Valid Node
---
Valid content"""
            
            (tree_dir / "no_id.md").write_text(no_id_content)
            (tree_dir / "valid.md").write_text(valid_content)
            
            loader = TreeLoader()
            result = loader.load_single_tree(str(tree_dir))
            
            # Should only load the file with node_id
            assert len(result["trees"][0].nodes) == 1
            assert result["trees"][0].nodes[0].node_id == "1"
    
    def test_empty_directory(self):
        """Test handling of empty tree directory"""
        with tempfile.TemporaryDirectory() as temp_dir:
            tree_dir = Path(temp_dir) / "2025-08-03"
            tree_dir.mkdir()
            
            loader = TreeLoader()
            result = loader.load_single_tree(str(tree_dir))
            
            # Should return empty trees list
            assert result["trees"] == []