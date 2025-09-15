"""
Integration test for chunk boundary handling with full pipeline including markdown generation.
Uses mocked LLM responses for deterministic testing.
"""

import os
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.text_to_graph_pipeline.agentic_workflows.models import (
    AppendAction, CreateAction)
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import \
    ChunkProcessor
from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import \
    WorkflowResult
from backend.tree_manager.markdown_tree_ds import \
    MarkdownTree
from backend.tree_manager.tree_to_markdown import \
    TreeToMarkdownConverter


class TestChunkBoundariesIntegration:
    """Test chunk boundary handling through the full pipeline with markdown generation"""
    
    @pytest.fixture
    def setup_test_environment(self, tmp_path):
        """Set up test environment with proper cleanup"""
        # Create test output directory
        output_dir = tmp_path / "test_markdown_output"
        output_dir.mkdir(exist_ok=True)
        
        # Initialize components
        decision_tree = MarkdownTree()
        converter = TreeToMarkdownConverter(decision_tree.tree)
        processor = ChunkProcessor(
            decision_tree,
            converter=converter,
            output_dir=str(output_dir),
            workflow_state_file=str(tmp_path / "test_workflow_state.json")
        )
        
        # Clear any existing state
        processor.clear_workflow_state()
        
        yield {
            "processor": processor,
            "decision_tree": decision_tree,
            "output_dir": output_dir,
            "converter": converter
        }
        
        # Cleanup is handled by tmp_path fixture
    
    # @pytest.mark.asyncio
    # @patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter.WorkflowAdapter.process_full_buffer')
    # async def test_chunk_boundaries_with_markdown_generation(self, mock_process_full_buffer, setup_test_environment):
    #     """Test that chunk boundaries are handled correctly and markdown files are generated"""
        
    #     env = setup_test_environment
    #     processor = env["processor"]
    #     decision_tree = env["decision_tree"]
    #     output_dir = env["output_dir"]
        
    #     # Simple mock that returns appropriate responses based on the content
    #     def mock_side_effect(transcript, *args, **kwargs):
    #         print(f"\nMock called with transcript: '{transcript[:80]}...'")
            
    #         # First call - NLP project creation
    #         if "natural language processing" in transcript:
    #             return WorkflowResult(
    #                 success=True,
    #                 new_nodes=["NLP Project"],
    #                 integration_decisions=[IntegrationDecision(
    #                     name="NLP Project",
    #                     text=transcript,
    #                     reasoning="Creating NLP project node",
    #                     action="CREATE",
    #                     target_node="Root",
    #                     new_node_name="NLP Project",
    #                     new_node_summary="## NLP Project\n\nDeveloping a natural language processing system using transformers.",
    #                     relationship_for_edge="child of",
    #                     content="## NLP Project\n\nDeveloping a natural language processing system using transformers."
    #                 )],
    #                 metadata={"chunks_processed": 1}
    #             )
    #         # Second call - features and architecture
    #         elif "entity recognition" in transcript or "features" in transcript:
    #             return WorkflowResult(
    #                 success=True,
    #                 new_nodes=["System Features"],
    #                 integration_decisions=[IntegrationDecision(
    #                     name="System Features",
    #                     text=transcript,
    #                     reasoning="Creating features node",
    #                     action="CREATE",
    #                     target_node="NLP Project",
    #                     new_node_name="System Features",
    #                     new_node_summary="## System Features\n\nKey features including entity recognition, sentiment analysis, and document classification.",
    #                     relationship_for_edge="child of",
    #                     content="## System Features\n\nKey features including entity recognition, sentiment analysis, and document classification."
    #                 )],
    #                 metadata={"chunks_processed": 1}
    #             )
    #         else:
    #             return WorkflowResult(success=False, error_message="Unexpected transcript")
        
    #     mock_process_full_buffer.side_effect = mock_side_effect
        
    #     # Test chunks that simulate real voice input with arbitrary boundaries
    #     # Buffer threshold is 183, so we need chunks that will trigger processing
    #     voice_chunks = [
    #         # Chunk 1: Long enough to exceed buffer threshold (200+ chars)
    #         "I'm working on a new project for natural language processing. This is a complex system that requires careful planning and architecture. The system will use state-of-the-art transformer",
    #         # Chunk 2: Completes previous word + adds new content (190+ chars)  
    #         " models for text analysis and processing. We need to implement several key features including entity recognition, sentiment analysis, and document classification capabilities",
    #         # Chunk 3: Additional content that will trigger another process
    #         " for our enterprise clients. The project deadline is next month and we need to ensure all components are properly tested and integrated before deployment."
    #     ]
        
    #     # Process each chunk
    #     for i, chunk in enumerate(voice_chunks):
    #         print(f"\nProcessing chunk {i+1}: '{chunk[:50]}...' ({len(chunk)} chars)")
    #         await processor.process_and_convert(chunk)
        
    #     # Process any remaining buffer content
    #     remaining_buffer = processor.buffer_manager.get_buffer()
    #     if remaining_buffer:
    #         print(f"\nProcessing remaining buffer: {len(remaining_buffer)} chars")
    #         await processor.process_new_text(remaining_buffer)
        
    #     # Finalize to ensure all nodes are converted to markdown
    #     await processor.finalize()
        
    #     # Verify the tree structure
    #     tree = decision_tree.tree
    #     assert len(tree) >= 2, f"Expected at least 2 nodes (root + 1 created), got {len(tree)}"
        
    #     # Verify markdown files were created
    #     markdown_files = list(output_dir.glob("*.md"))
    #     assert len(markdown_files) >= 1, f"Expected at least 1 markdown file, found {len(markdown_files)}"
        
    #     # Verify that files contain expected content
    #     all_content = ""
    #     for md_file in markdown_files:
    #         content = md_file.read_text()
    #         all_content += content.lower()
    #         print(f"\nMarkdown file {md_file.name} contains {len(content)} chars")
        
    #     # Verify key content appears somewhere in the generated files
    #     assert "nlp" in all_content or "natural language" in all_content, "NLP content not found in any markdown file"
        
    #     # Verify that chunks were processed correctly despite boundaries
    #     assert mock_process_full_buffer.call_count >= 1, "Expected at least 1 workflow call"
    #     print(f"\nTotal workflow calls: {mock_process_full_buffer.call_count}")
    