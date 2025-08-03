#!/usr/bin/env python3
"""
Test suite for graph_dependency_traversal_and_accumulate_graph_content.py
Tests behavioral aspects including child traversal, parent traversal, and TF-IDF functionality.
"""

import unittest
import subprocess
import tempfile
import json
from pathlib import Path


class TestGraphDependencyTraversal(unittest.TestCase):
    """Test cases for the graph dependency traversal tool."""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment."""
        cls.test_vault_dir = Path("/Users/bobbobby/repos/VoiceTree/markdownTreeVaultDefault/2025-08-03")
        cls.script_path = Path("/Users/bobbobby/repos/VoiceTree/tools/graph_dependency_traversal_and_accumulate_graph_content.py")
        
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


if __name__ == "__main__":
    unittest.main(verbosity=2)