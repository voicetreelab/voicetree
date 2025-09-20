#!/usr/bin/env python3
"""
Test suite for graph_dependency_traversal_and_accumulate_graph_content.py
Tests behavioral aspects including child traversal, parent traversal, and TF-IDF functionality.
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class TestGraphDependencyTraversal(unittest.TestCase):
    """Test cases for the graph dependency traversal tool."""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment."""
        # Simple relative paths from tools folder
        cls.test_vault_dir = Path("../markdownTreeVaultDefault/2025-08-03")
        cls.script_path = Path("./graph_dependency_traversal_and_accumulate_graph_content.py")
        
        # Verify test environment
        if not cls.test_vault_dir.exists():
            raise RuntimeError(f"Test vault directory not found: {cls.test_vault_dir}")
        if not cls.script_path.exists():
            raise RuntimeError(f"Script not found: {cls.script_path}")
    
    def run_traversal(self, start_file, num_relevant=3):
        """Helper to run the traversal script and return output."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as tmp:
            output_file = tmp.name
        
        try:
            cmd = [
                "python", str(self.script_path),
                str(self.test_vault_dir),
                start_file,
                "-o", output_file,
                "-n", str(num_relevant)
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # Check for errors
            if result.returncode != 0:
                self.fail(f"Script failed with error: {result.stderr}")
            
            # Read and return the output
            output_path = Path(output_file)
            if output_path.exists():
                return output_path.read_text()
            else:
                self.fail("Output file was not created")
                
        finally:
            # Clean up
            Path(output_file).unlink(missing_ok=True)
    
    def test_node_3_1_traversal(self):
        """Test traversal from node 3_1 - should find children and show parent info."""
        output = self.run_traversal("3_1_Node_Placement_Optimization_Design.md")
        
        # Check that the main node is included
        self.assertIn("Node Placement Optimization Design (3_1)", output)
        
        # Check that it found the child node (3_2)
        self.assertIn("3_2_Current_Node_Placement_Algorithm.md", output)
        self.assertIn("Current Node Placement Algorithm Explained (3_2)", output)
        
        # The parent link should be visible in the content
        self.assertIn("[[2025-08-03/3_Optimize_New_Node_Placement.md]]", output)
        
        # Check TF-IDF found relevant nodes
        self.assertIn("RELEVANT NODES", output)
        self.assertIn("TF-IDF Inverse Document Search", output)
    
    def test_recursive_depth_traversal(self):
        """Test that recursive traversal goes multiple levels deep."""
        # Start from node 20 which has a deeper tree
        output = self.run_traversal("20_Orchestration_Mode_Child_Node_Interaction.md")
        
        # Check all levels are found
        self.assertIn("20_Orchestration_Mode_Child_Node_Interaction.md", output)
        self.assertIn("21_Recursive_Dependency_Traversal.md", output)
        self.assertIn("21_1_Recursive_Child_Traversal_Pseudocode.md", output)
        self.assertIn("21_2_Recursive_Traversal_Example.md", output)
        
        # Verify the deepest node content is included
        self.assertIn("Visual example of how recursive child traversal works", output)
    
    def test_tf_idf_relevance(self):
        """Test that TF-IDF finds relevant nodes based on content similarity."""
        output = self.run_traversal("3_1_Node_Placement_Optimization_Design.md", num_relevant=5)
        
        # Should find relevant nodes section
        self.assertIn("RELEVANT NODES", output)
        
        # Should include similarity scores
        self.assertIn("Similarity:", output)
        
        # Count number of relevant nodes returned
        similarity_count = output.count("(Similarity:")
        self.assertGreaterEqual(similarity_count, 1, "Should find at least 1 relevant node")
        self.assertLessEqual(similarity_count, 5, "Should not exceed requested limit")
    
    def test_circular_dependency_handling(self):
        """Test that circular dependencies don't cause infinite loops."""
        # If we have circular deps in test data, this should complete without hanging
        # Using a file that might have circular references
        output = self.run_traversal("11_Demonstrate_Agent_Chain_Functionality.md")
        
        # Should complete successfully
        self.assertIn("BRANCH 1:", output)
        
        # Check that visited nodes aren't duplicated in output
        lines = output.split('\n')
        file_headers = [line for line in lines if line.strip().startswith("File:")]
        
        # Count occurrences of each file
        file_counts = {}
        for header in file_headers:
            if header in file_counts:
                file_counts[header] += 1
            else:
                file_counts[header] = 1
        
        # No file should appear more than once in a branch
        for file, count in file_counts.items():
            self.assertEqual(count, 1, f"File {file} appeared {count} times, should only appear once")
    
    def test_nonexistent_file_handling(self):
        """Test graceful handling of nonexistent starting file."""
        # Run the tool with capturing stderr
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as tmp:
            output_file = tmp.name
        
        try:
            cmd = [
                "python", str(self.script_path),
                str(self.test_vault_dir),
                "nonexistent_file.md",
                "-o", output_file
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            # Should complete without error
            self.assertEqual(result.returncode, 0)
            
            # Should show warning in stdout
            self.assertIn("Warning: File not found", result.stdout)
            self.assertIn("nonexistent_file.md", result.stdout)
            
            # Output file should be created but empty
            self.assertTrue(Path(output_file).exists())
            content = Path(output_file).read_text()
            self.assertEqual(content, "")  # Empty output for nonexistent file
            
        finally:
            Path(output_file).unlink(missing_ok=True)
    
    def test_multiple_starting_files(self):
        """Test traversal with multiple starting points."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as tmp:
            output_file = tmp.name
        
        try:
            cmd = [
                "python", str(self.script_path),
                str(self.test_vault_dir),
                "3_1_Node_Placement_Optimization_Design.md",
                "20_Orchestration_Mode_Child_Node_Interaction.md",
                "-o", output_file
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                self.fail(f"Script failed with error: {result.stderr}")
            
            output = Path(output_file).read_text()
            
            # Should have two branches
            self.assertIn("BRANCH 1:", output)
            self.assertIn("BRANCH 2:", output)
            
            # Both starting nodes should be processed
            self.assertIn("3_1_Node_Placement_Optimization_Design.md", output)
            self.assertIn("20_Orchestration_Mode_Child_Node_Interaction.md", output)
            
        finally:
            Path(output_file).unlink(missing_ok=True)
    
    def test_parent_pattern_detection(self):
        """Test that various parent link patterns are detected."""
        output = self.run_traversal("21_1_Recursive_Child_Traversal_Pseudocode.md")
        
        # This node has a specific parent pattern
        self.assertIn("implements_pseudocode_for", output)
        
        # Its child should also be found
        self.assertIn("21_2_Recursive_Traversal_Example.md", output)
        self.assertIn("clarifies_recursion_in", output)
    
    def test_actual_problem_case(self):
        """Test the actual problem case from issue 14116 - should traverse to parent."""
        # Create a test scenario similar to the problem
        # We'll use an existing test file structure
        output = self.run_traversal("3_2_Current_Node_Placement_Algorithm.md")
        
        # Should find its parent (3_1)
        self.assertIn("3_1_Node_Placement_Optimization_Design.md", output)
        
        # Should also find the grandparent (3) if it exists in content
        # Check that we traverse UP the hierarchy
        file_count = output.count("File:")
        self.assertGreaterEqual(file_count, 2, "Should traverse to at least parent node")
        
        # Verify parent content is actually included, not just mentioned
        self.assertIn("Node Placement Optimization Design", output)
    
    def test_bidirectional_traversal(self):
        """Test that traversal goes both up to parents and down to children."""
        # Start from a middle node that has both parents and children
        output = self.run_traversal("21_Recursive_Dependency_Traversal.md")
        
        # Should find the parent (node 20)
        self.assertIn("20_Orchestration_Mode_Child_Node_Interaction.md", output)
        self.assertIn("Orchestration Mode Child Node Interaction", output)
        
        # Should find the children (21_1 and 21_2)
        self.assertIn("21_1_Recursive_Child_Traversal_Pseudocode.md", output)
        self.assertIn("21_2_Recursive_Traversal_Example.md", output)
        
        # Verify content from both parent and children are included
        self.assertIn("implements_pseudocode_for", output)  # Child relationship
        
        # Count that we have at least 3 files (parent + current + children)
        file_count = output.count("File:")
        self.assertGreaterEqual(file_count, 3, "Should traverse to parent and children")
    
    def test_directory_path_resolution(self):
        """Test that parent links without directory prefixes are resolved correctly."""
        # Create test files in a dated subdirectory to simulate the real issue
        test_dir = Path(self.test_vault_dir)
        dated_dir = test_dir / "2025-test" 
        dated_dir.mkdir(exist_ok=True)
        
        try:
            # Create parent file
            parent_file = dated_dir / "test_parent.md"
            parent_content = """---
node_id: test_parent
title: Test Parent
---
### This is the parent node
Some content here."""
            parent_file.write_text(parent_content)
            
            # Create child file with link WITHOUT directory prefix (the issue we're fixing)
            child_file = dated_dir / "test_child.md"
            child_content = """---
node_id: test_child
title: Test Child
---
### This is the child node

-----------------
_Links:_
Parent:
- is_child_of [[test_parent.md]]"""
            child_file.write_text(child_content)
            
            # Create grandchild to test deeper traversal
            grandchild_file = dated_dir / "test_grandchild.md"
            grandchild_content = """---
node_id: test_grandchild  
title: Test Grandchild
---
### This is the grandchild node

-----------------
_Links:_
Parent:
- is_child_of [[test_child.md]]"""
            grandchild_file.write_text(grandchild_content)
            
            # Run traversal from grandchild
            output = self.run_traversal("2025-test/test_grandchild.md")
            
            # Should find all three levels
            self.assertIn("test_grandchild", output)
            self.assertIn("test_child", output) 
            self.assertIn("test_parent", output)
            
            # Verify the full chain is traversed
            branch_section = output.split("RELEVANT NODES")[0] if "RELEVANT NODES" in output else output
            file_count = branch_section.count("File: 2025-test/test_")
            self.assertEqual(file_count, 3, 
                f"Should traverse all 3 levels with directory resolution, got {file_count}")
            
            # Verify parent content is included
            self.assertIn("This is the parent node", output)
            self.assertIn("This is the child node", output)
            self.assertIn("This is the grandchild node", output)
            
        finally:
            # Clean up test files
            import shutil
            if dated_dir.exists():
                shutil.rmtree(dated_dir)
    
    def test_mixed_link_formats(self):
        """Test handling of mixed link formats (with and without directory prefixes)."""
        test_dir = Path(self.test_vault_dir)
        mixed_dir = test_dir / "mixed-test"
        mixed_dir.mkdir(exist_ok=True)
        
        try:
            # Create a chain with mixed link formats
            # Node A (root)
            node_a = mixed_dir / "node_a.md"
            node_a.write_text("""---
node_id: node_a
title: Node A
---
### Root node A""")
            
            # Node B links to A with full path
            node_b = mixed_dir / "node_b.md"
            node_b.write_text("""---
node_id: node_b
title: Node B
---
### Node B
Parent:
- links_to [[mixed-test/node_a.md]]""")
            
            # Node C links to B without directory
            node_c = mixed_dir / "node_c.md"
            node_c.write_text("""---
node_id: node_c
title: Node C
---
### Node C
Parent:
- links_to [[node_b.md]]""")
            
            # Node D links to C without directory
            node_d = mixed_dir / "node_d.md"
            node_d.write_text("""---
node_id: node_d
title: Node D  
---
### Node D
Parent:
- links_to [[node_c.md]]""")
            
            # Run traversal from D
            output = self.run_traversal("mixed-test/node_d.md")
            
            # Should find all four nodes
            branch_section = output.split("RELEVANT NODES")[0] if "RELEVANT NODES" in output else output
            
            self.assertIn("Node A", branch_section)
            self.assertIn("Node B", branch_section)
            self.assertIn("Node C", branch_section)
            self.assertIn("Node D", branch_section)
            
            # Count files in branch
            file_count = branch_section.count("File: mixed-test/node_")
            self.assertEqual(file_count, 4,
                f"Should traverse all 4 levels with mixed formats, got {file_count}")
            
        finally:
            # Clean up
            import shutil
            if mixed_dir.exists():
                shutil.rmtree(mixed_dir)
    
    def test_max_depth_limit(self):
        """Test that traversal stops at max_depth=10 even if more levels exist."""
        # First, let's create a deep chain of test files to ensure we have >10 levels
        test_dir = Path(self.test_vault_dir)
        
        # Create a chain of markdown files with parent links
        # We'll create files in a temporary test subdirectory
        deep_test_dir = test_dir / "deep_test"
        deep_test_dir.mkdir(exist_ok=True)
        
        try:
            # Create a chain of 15 files, each linking to the previous
            for i in range(15):
                filename = f"depth_{i}.md"
                filepath = deep_test_dir / filename
                
                content = f"---\nnode_id: depth_{i}\ntitle: Depth Test {i}\n---\n"
                content += f"### This is node at depth {i}\n\n"
                
                # Add link to parent (previous file)
                if i > 0:
                    parent_file = f"depth_{i-1}.md"
                    content += f"Parent:\n- is_a_child_of [[deep_test/{parent_file}]]\n"
                
                filepath.write_text(content)
            
            # Now run traversal starting from the deepest file (depth_14.md)
            # It should traverse up through parents but stop at depth 10
            output = self.run_traversal("deep_test/depth_14.md")
            
            # Count how many files were traversed in the BRANCH section (not TF-IDF)
            # Split output to only look at the traversed branch, not TF-IDF results
            branch_section = output.split("RELEVANT NODES")[0] if "RELEVANT NODES" in output else output
            file_count = branch_section.count("File: deep_test/depth_")
            
            # Should have exactly 11 files (depth_14 through depth_4, inclusive)
            # That's: current (14) + 10 parent levels (13,12,11,10,9,8,7,6,5,4)
            self.assertEqual(file_count, 11, 
                f"Should stop at max_depth=10, got {file_count} files in traversal")
            
            # Verify we have the starting file in the branch section
            self.assertIn("depth_14.md", branch_section)
            
            # Verify we have files up to depth 4 (10 levels up from 14) in the branch section
            self.assertIn("depth_4.md", branch_section)
            
            # Verify we DON'T have files beyond depth 3 in the BRANCH section (would be 11+ levels)
            # Note: They may appear in TF-IDF section, but not in the actual traversal
            self.assertNotIn("File: deep_test/depth_3.md", branch_section)
            self.assertNotIn("File: deep_test/depth_2.md", branch_section)
            self.assertNotIn("File: deep_test/depth_1.md", branch_section)
            self.assertNotIn("File: deep_test/depth_0.md", branch_section)
            
        finally:
            # Clean up test files
            import shutil
            if deep_test_dir.exists():
                shutil.rmtree(deep_test_dir)


if __name__ == "__main__":
    unittest.main(verbosity=2)