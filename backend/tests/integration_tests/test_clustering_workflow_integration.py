"""
Integration test for the complete clustering workflow including DIANA's markdown tag functionality.

Tests the integration between CHARLIE's workflow driver and DIANA's cluster tag implementation.
"""

import pytest
import tempfile
import os
from datetime import datetime
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import Node
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter
from backend.text_to_graph_pipeline.agentic_workflows.clustering_workflow_driver import run_clustering_analysis


@pytest.mark.asyncio
async def test_clustering_workflow_with_markdown_tags():
    """Test that cluster tags appear in markdown after running clustering workflow"""
    
    # Create test tree with sample nodes
    tree = {
        1: Node(node_id=1, name="Golden Retriever", content="Golden Retrievers are friendly dogs...", 
                summary="Information about Golden Retriever breed"),
        2: Node(node_id=2, name="Persian Cat", content="Persian cats have long fur...", 
                summary="Details about Persian cat breed"),
        3: Node(node_id=3, name="Parrot", content="Parrots are colorful birds...", 
                summary="Overview of parrot species"),
    }
    
    # Run CHARLIE's clustering workflow
    await run_clustering_analysis(tree)
    
    # Verify cluster_name attributes were added to nodes
    for node in tree.values():
        assert hasattr(node, 'cluster_name'), f"Node {node.id} missing cluster_name attribute"
    
    # Convert to markdown using DIANA's implementation
    with tempfile.TemporaryDirectory() as temp_dir:
        converter = TreeToMarkdownConverter(tree)
        converter.convert_nodes(output_dir=temp_dir, nodes_to_update=set(tree.keys()))
        
        # Check that cluster tags appear in generated markdown files
        for node_id, node in tree.items():
            file_path = os.path.join(temp_dir, node.filename)
            assert os.path.exists(file_path), f"Markdown file not created for node {node_id}"
            
            with open(file_path, 'r') as f:
                content = f.read()
                lines = content.split('\n')
                
                if node.cluster_name:
                    # First line should be cluster tag
                    assert lines[0] == f"#{node.cluster_name}", \
                        f"Expected cluster tag #{node.cluster_name}, got: {lines[0]}"
                    # Second line should be YAML frontmatter
                    assert lines[1] == "---", "YAML frontmatter should start on second line"
                else:
                    # No cluster tag, should start with YAML frontmatter
                    assert lines[0] == "---", "Should start with YAML frontmatter when no cluster"
                    
                # Verify content is preserved
                assert f"node_id: {node_id}" in content
                assert node.summary in content


