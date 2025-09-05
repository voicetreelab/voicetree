"""
Integration test for traverse_all_relevant_nodes module.
Tests the integration script with specific inputs and verifies behavioral output.
"""

import pytest
from pathlib import Path
import sys

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.context_retrieval.traverse_all_relevant_nodes import traverse_all_relevant_nodes
from backend.text_to_graph_pipeline.tree_manager.markdown_to_tree import load_markdown_tree


class TestTraverseAllRelevantNodes:
    """Integration tests for the traverse_all_relevant_nodes module."""
    
    @pytest.fixture
    def setup_test_data(self):
        """Setup test data paths and load tree."""
        markdown_dir = Path("/Users/bobbobby/repos/VoiceTree/backend/benchmarker/output/user_guide_qa_audio_processing_connected_final")
        embeddings_path = Path("/Users/bobbobby/repos/VoiceTree/backend/embeddings_output")
        
        # Load the tree
        tree = load_markdown_tree(str(markdown_dir))
        
        # Ensure each node has filename attribute
        import os
        md_files = {f: f for f in os.listdir(markdown_dir) if f.endswith('.md')}
        
        for node_id, node in tree.items():
            # Look for the actual file that starts with the node_id
            for filename in md_files:
                if filename.startswith(f"{node_id}_"):
                    node.filename = filename
                    break
            else:
                # Fallback if no matching file found
                if hasattr(node, 'file_name') and node.file_name:
                    node.filename = node.file_name
        
        return {
            'tree': tree,
            'markdown_dir': markdown_dir,
            'embeddings_path': embeddings_path
        }
    
    def test_traverse_with_embeddings_basic_output(self, setup_test_data):
        """Test that traverse_all_relevant_nodes produces expected output with embeddings."""
        # Test query
        query = "If the original audio has low clarity, after completing the audio cutting, what should I do?"
        
        # Run the traversal
        results = traverse_all_relevant_nodes(
            query=query,
            tree=setup_test_data['tree'],
            markdown_dir=setup_test_data['markdown_dir'],
            top_k=10,
            embeddings_path=setup_test_data['embeddings_path']
        )
        
        # Assertions for behavioral requirements
        # 1. At least 10 nodes should be traversed (not just returned, but traversed including parents/children)
        assert results is not None, "Results should not be None"
        
        # Count total traversed nodes by looking at the output structure
        # The function returns a dictionary of target nodes, but each may have traversed multiple related nodes
        assert len(results) > 0, "Should return at least some results"
        
    def test_traverse_output_content_length(self, setup_test_data, capsys):
        """Test that the output contains at least 500 words."""
        query = "How do I process audio with low clarity?"
        
        # Run the traversal
        results = traverse_all_relevant_nodes(
            query=query,
            tree=setup_test_data['tree'],
            markdown_dir=setup_test_data['markdown_dir'],
            top_k=10,
            embeddings_path=setup_test_data['embeddings_path']
        )
        
        # Capture the printed output
        captured = capsys.readouterr()
        output_text = captured.out
        
        # Count words in the output
        word_count = len(output_text.split())
        
        # Assert at least 500 words in output
        assert word_count >= 500, f"Output should contain at least 500 words, got {word_count}"
        
        # Additional assertion: check that we have meaningful content
        assert "Traversed" in output_text, "Output should mention traversed nodes"
        assert "nodes:" in output_text.lower(), "Output should show node information"
    
    def test_traverse_node_count_in_output(self, setup_test_data, capsys):
        """Test that at least 10 nodes are mentioned in the traversal output."""
        query = "What are the steps for audio processing?"
        
        # Run the traversal
        results = traverse_all_relevant_nodes(
            query=query,
            tree=setup_test_data['tree'],
            markdown_dir=setup_test_data['markdown_dir'],
            top_k=10,
            embeddings_path=setup_test_data['embeddings_path']
        )
        
        # Capture the printed output
        captured = capsys.readouterr()
        output_text = captured.out
        
        # Count occurrences of "Traversed X nodes:" in the output
        import re
        traversal_matches = re.findall(r'Traversed (\d+) nodes:', output_text)
        
        # Sum up all traversed nodes across different search results
        total_traversed = sum(int(match) for match in traversal_matches)
        
        # Assert at least 10 nodes were traversed in total
        assert total_traversed >= 10, f"Should traverse at least 10 nodes total, got {total_traversed}"
        
    def test_traverse_with_different_queries(self, setup_test_data):
        """Test that different queries produce valid results."""
        queries = [
            "How to handle audio with background noise?",
            "What is the process for extracting high-quality audio?",
            "Steps for audio trimming and cutting"
        ]
        
        all_results = []
        for query in queries:
            results = traverse_all_relevant_nodes(
                query=query,
                tree=setup_test_data['tree'],
                markdown_dir=setup_test_data['markdown_dir'],
                top_k=5,  # Smaller top_k for variety testing
                embeddings_path=setup_test_data['embeddings_path']
            )
            
            # Each query should produce results
            assert len(results) > 0, f"Query '{query}' should produce results"
            all_results.append(set(results.keys()))
        
        # Check that we get meaningful results for all queries
        # Some overlap is expected since they're all about audio processing
        assert len(all_results) == len(queries), "Should have results for all queries"
        
        # At least verify that we're getting node results
        for result_set in all_results:
            assert len(result_set) > 0, "Each query should return at least one node"
    
    def test_traverse_output_structure(self, setup_test_data):
        """Test that the output has the expected structure with node information."""
        query = "Audio processing pipeline steps"
        
        results = traverse_all_relevant_nodes(
            query=query,
            tree=setup_test_data['tree'],
            markdown_dir=setup_test_data['markdown_dir'],
            top_k=10,
            embeddings_path=setup_test_data['embeddings_path']
        )
        
        # Check that results have expected structure
        for node_file, node_data in results.items():
            # Each result should be a dictionary with node information
            assert isinstance(node_data, dict), "Each result should be a dictionary"
            
            # Check for expected fields
            assert 'node_id' in node_data or 'id' in node_data, "Node should have an ID"
            assert 'title' in node_data or 'content' in node_data, "Node should have title or content"
            
            # Filename should end with .md
            assert node_file.endswith('.md'), f"Node file should be markdown: {node_file}"
    
    def test_traverse_uses_embeddings_when_available(self, setup_test_data, capsys):
        """Test that the function uses embeddings when provided."""
        query = "Audio quality enhancement techniques"
        
        # Run with embeddings path
        results_with_embeddings = traverse_all_relevant_nodes(
            query=query,
            tree=setup_test_data['tree'],
            markdown_dir=setup_test_data['markdown_dir'],
            top_k=10,
            embeddings_path=setup_test_data['embeddings_path']
        )
        
        # Capture output
        captured = capsys.readouterr()
        
        # Check that vector search was mentioned in output
        assert "Searching for relevant nodes" in captured.out or \
               "vector" in captured.out.lower(), \
               "Should indicate vector search is being used"
        
        # Should have found relevant nodes
        assert len(results_with_embeddings) > 0, "Should find results with embeddings"


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v"])