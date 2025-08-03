import unittest
import os
import tempfile
import shutil
import yaml

from backend.text_to_graph_pipeline.tree_manager.node_processor import NodeProcessor


class TestNodeProcessor(unittest.TestCase):
    def setUp(self):
        # Create temporary directory for test markdown files
        self.test_dir = tempfile.mkdtemp()
        
        # Create sample markdown files with existing YAML frontmatter
        self.sample_files = {
            "1_Demo_Completion_Goal.md": """---
node_id: 1
title: Demo Completion Goal (1)
---

# Demo Completion Goal

This is the content of the demo completion goal node.
""",
            "2_Verify_VoiceTree_Functionality.md": """---
node_id: 2  
title: Verify VoiceTree Functionality (2)
---

# Verify VoiceTree Functionality

Content about verifying functionality.
""",
            "3_UI_Component_Setup.md": """---
node_id: 3
title: UI Component Setup (3)
---

# UI Component Setup

Content about UI setup.
""",
            "5_Fix_Navigation_Bug.md": """---
node_id: 5
title: Fix Navigation Bug (5)
---

# Fix Navigation Bug

Content about navigation bug fix.
""",
            "7_Unclassified_Node.md": """---
node_id: 7
title: Unclassified Node (7)
---

# Unclassified Node

This node won't be assigned to any subtree.
"""
        }
        
        # Write sample files to test directory
        for filename, content in self.sample_files.items():
            file_path = os.path.join(self.test_dir, filename)
            with open(file_path, 'w') as f:
                f.write(content)
                
        # Sample classified subtree data (matches the format from the task description)
        self.classified_data = {
            "classified_trees": [
                {
                    "tree_id": "2025-08-02_20250802_150743",
                    "subtrees": [
                        {
                            "subtree_id": "demo_preparation",
                            "container_type": "project_phase",
                            "nodes": ["1", "2", "3"],
                            "theme": "VoiceTree demo preparation and setup"
                        },
                        {
                            "subtree_id": "ui_fixes",
                            "container_type": "technical_work",
                            "nodes": ["5"],
                            "theme": "User interface bug fixes and improvements"
                        }
                    ],
                    "unclassified_nodes": ["7"]
                }
            ]
        }

    def tearDown(self):
        # Clean up temporary directory
        shutil.rmtree(self.test_dir)

    def test_process_classified_trees(self):
        """Test that NodeProcessor correctly updates markdown files with subtree metadata"""
        processor = NodeProcessor()
        
        # Process the classified data
        processor.process_classified_trees(self.classified_data, self.test_dir)
        
        # Verify demo_preparation subtree nodes (1, 2, 3) have correct metadata
        for node_id in ["1", "2", "3"]:
            file_path = self._get_file_path_for_node(node_id)
            self.assertTrue(os.path.exists(file_path), f"File for node {node_id} should exist")
            
            with open(file_path, 'r') as f:
                content = f.read()
                
            # Parse YAML frontmatter
            yaml_data = self._extract_yaml_frontmatter(content)
            
            # Verify subtree metadata was added
            self.assertIn('subtree_color', yaml_data)
            self.assertEqual(yaml_data['subtree_id'], 'demo_preparation')
            self.assertEqual(yaml_data['subtree_theme'], 'VoiceTree demo preparation and setup')
            
            # Verify original metadata is preserved
            self.assertEqual(yaml_data['node_id'], int(node_id))
            self.assertIn('title', yaml_data)
            
        # Verify ui_fixes subtree node (5) has correct metadata  
        file_path = self._get_file_path_for_node("5")
        with open(file_path, 'r') as f:
            content = f.read()
        yaml_data = self._extract_yaml_frontmatter(content)
        
        self.assertIn('subtree_color', yaml_data)
        self.assertEqual(yaml_data['subtree_id'], 'ui_fixes')
        self.assertEqual(yaml_data['subtree_theme'], 'User interface bug fixes and improvements')
        
        # Verify unclassified node (7) has no subtree metadata
        file_path = self._get_file_path_for_node("7")
        with open(file_path, 'r') as f:
            content = f.read()
        yaml_data = self._extract_yaml_frontmatter(content)
        
        self.assertNotIn('subtree_color', yaml_data)
        self.assertNotIn('subtree_id', yaml_data)
        self.assertNotIn('subtree_theme', yaml_data)
        
        # Verify original metadata is still preserved for unclassified node
        self.assertEqual(yaml_data['node_id'], 7)
        self.assertIn('title', yaml_data)

    def test_consistent_colors_for_same_subtree(self):
        """Test that nodes in the same subtree get the same color"""
        processor = NodeProcessor()
        processor.process_classified_trees(self.classified_data, self.test_dir)
        
        # Get colors for demo_preparation subtree nodes
        colors = []
        for node_id in ["1", "2", "3"]:
            file_path = self._get_file_path_for_node(node_id)
            with open(file_path, 'r') as f:
                content = f.read()
            yaml_data = self._extract_yaml_frontmatter(content)
            colors.append(yaml_data['subtree_color'])
        
        # All nodes in same subtree should have same color
        self.assertTrue(all(color == colors[0] for color in colors))
        
        # ui_fixes subtree should have different color than demo_preparation
        file_path = self._get_file_path_for_node("5")
        with open(file_path, 'r') as f:
            content = f.read()
        yaml_data = self._extract_yaml_frontmatter(content)
        ui_fixes_color = yaml_data['subtree_color']
        
        self.assertNotEqual(ui_fixes_color, colors[0])

    def _get_file_path_for_node(self, node_id):
        """Helper to get file path for a node based on existing sample files"""
        filename_map = {
            "1": "1_Demo_Completion_Goal.md",
            "2": "2_Verify_VoiceTree_Functionality.md", 
            "3": "3_UI_Component_Setup.md",
            "5": "5_Fix_Navigation_Bug.md",
            "7": "7_Unclassified_Node.md"
        }
        return os.path.join(self.test_dir, filename_map[node_id])
        
    def _extract_yaml_frontmatter(self, content):
        """Helper to extract and parse YAML frontmatter from markdown content"""
        lines = content.strip().split('\n')
        if lines[0] != '---':
            raise ValueError("Content does not start with YAML frontmatter")
            
        # Find end of frontmatter
        end_index = None
        for i, line in enumerate(lines[1:], 1):
            if line == '---':
                end_index = i
                break
                
        if end_index is None:
            raise ValueError("YAML frontmatter not properly closed")
            
        yaml_content = '\n'.join(lines[1:end_index])
        return yaml.safe_load(yaml_content)


if __name__ == '__main__':
    unittest.main()