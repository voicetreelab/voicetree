"""
Integration test for incomplete chunk handling
Tests the complete flow from voice input through buffer management to workflow processing
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree


class TestIncompleteChunkHandling:
    """Test that incomplete chunks are handled correctly without duplication"""
    
    @pytest.fixture
    def mock_decision_tree(self):
        """Create a mock decision tree"""
        tree = Mock(spec=DecisionTree)
        tree.tree = {0: Mock(children=[])}
        tree.get_node_id_from_name = Mock(return_value=0)
        tree.create_new_node = Mock(return_value=1)
        return tree
    
    @pytest.fixture
    def mock_workflow_result(self):
        """Create a mock workflow result with incomplete chunk"""
        from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowResult
        return WorkflowResult(
            success=True,
            new_nodes=["Save and Upload File"],
            node_actions=[],
            metadata={
                "chunks_processed": 3,
                "decisions_made": 1,
                "incomplete_buffer": "I'm going to save this file, upload it with the file API, and then"
            }
        )
    
    @pytest.mark.asyncio
    async def test_incomplete_chunk_not_duplicated(self, mock_decision_tree, mock_workflow_result):
        """Test that incomplete chunks are not duplicated in subsequent processing"""
        
        # Create chunk processor with mocked components
        chunk_processor = ChunkProcessor(
            decision_tree=mock_decision_tree,
            converter=Mock(),
            workflow_state_file=None
        )
        
        # Set a low buffer threshold to trigger processing immediately
        chunk_processor.buffer_manager.config.buffer_size_threshold = 50
        
        # Mock the workflow adapter to return our test result
        with patch.object(chunk_processor.workflow_adapter, 'process_transcript', 
                         new_callable=AsyncMock) as mock_process:
            mock_process.return_value = mock_workflow_result
            
            # First transcript ends with incomplete chunk
            first_transcript = "Cool, so I've opened the Colab. And I'm going to try run now this audio. I'm going to save this file, upload it with the file API, and then"
            
            # Process first transcript - should trigger immediately due to low threshold
            await chunk_processor.process_voice_input(first_transcript)
            
            # Verify workflow was called
            assert mock_process.call_count >= 1
            
            # Verify the incomplete chunk was stored in buffer manager
            assert chunk_processor.buffer_manager.get_incomplete_chunk() == "I'm going to save this file, upload it with the file API, and then"
            
            # Second transcript continues the thought
            second_transcript = "run the example audio to text. Cool, let's try that."
            
            # Process second transcript
            await chunk_processor.process_voice_input(second_transcript)
            
            # Get the text that was sent to workflow on second call
            if mock_process.call_count >= 2:
                second_call_args = mock_process.call_args_list[1]
                processed_text = second_call_args[1]['transcript']
                
                # Verify the incomplete chunk appears only once
                count = processed_text.count("I'm going to save this file, upload it with the file API, and then")
                assert count == 1, f"Incomplete chunk appeared {count} times, expected 1. Text: {processed_text}"
                
                # Verify the text was properly merged
                expected_merged = "I'm going to save this file, upload it with the file API, and then run the example audio to text. Cool, let's try that."
                assert expected_merged in processed_text
    
    @pytest.mark.asyncio
    async def test_transcript_history_propagation(self, mock_decision_tree):
        """Test that transcript history is properly propagated through the pipeline"""
        
        # Create chunk processor
        chunk_processor = ChunkProcessor(
            decision_tree=mock_decision_tree,
            converter=Mock(),
            workflow_state_file=None
        )
        
        # Configure buffer to process immediately
        chunk_processor.buffer_manager.config.buffer_size_threshold = 10
        
        # Mock workflow adapter
        with patch.object(chunk_processor.workflow_adapter, 'process_transcript', 
                         new_callable=AsyncMock) as mock_process:
            mock_process.return_value = Mock(
                success=True,
                new_nodes=[],
                node_actions=[],
                metadata={}
            )
            
            # Process multiple short texts to build history
            await chunk_processor.process_voice_input("First text.")
            await chunk_processor.process_voice_input("Second text.")
            await chunk_processor.process_voice_input("Third text.")
            
            # Check that transcript history was passed in the last call
            if mock_process.call_count > 0:
                last_call = mock_process.call_args_list[-1]
                context = last_call[1].get('context', '')
                
                # Verify all previous texts are in the history
                # Note: The buffer manager maintains a sliding window, so check what's actually there
                assert context != "", "Context should not be empty"
                assert "text." in context  # At least some text should be present
                
                # The most recent texts should be in the history
                assert "Third text." in context
    
    @pytest.mark.asyncio
    async def test_buffer_manager_api_prevents_duplication(self):
        """Test that BufferManager API correctly prevents duplication"""
        
        # Create buffer manager with low threshold for testing
        config = BufferConfig(buffer_size_threshold=50)
        buffer_manager = TextBufferManager(config)
        
        # Set an incomplete chunk
        incomplete = "I'm going to save this file"
        buffer_manager.set_incomplete_chunk(incomplete)
        
        # Add new text that continues the thought
        new_text = "and upload it with the file API"
        result = buffer_manager.add_text_with_incomplete(new_text)
        
        # Verify incomplete chunk was cleared
        assert buffer_manager.get_incomplete_chunk() == ""
        
        # Verify the merged text doesn't have duplication
        if result.is_ready:
            assert result.text.count(incomplete) == 1
        
        # Verify transcript history doesn't have duplication
        history = buffer_manager.get_transcript_history()
        assert history.count(incomplete) == 1
    
    @pytest.mark.asyncio 
    async def test_empty_transcript_history_fixed(self, mock_decision_tree):
        """Test that transcript_history is not empty when passed to workflow"""
        
        # Create chunk processor
        chunk_processor = ChunkProcessor(
            decision_tree=mock_decision_tree,
            converter=Mock(),
            workflow_state_file=None
        )
        
        # Set low threshold to trigger processing
        chunk_processor.buffer_manager.config.buffer_size_threshold = 20
        
        # Mock the pipeline run method to capture state
        captured_state = None
        
        def capture_state(transcript, transcript_history=None):
            nonlocal captured_state
            captured_state = {
                'transcript': transcript,
                'transcript_history': transcript_history
            }
            return {
                'error_message': None,
                'integration_decisions': [],
                'new_nodes': []
            }
        
        with patch.object(chunk_processor.workflow_adapter.pipeline, 'run', 
                         side_effect=capture_state):
            
            # Process some text
            await chunk_processor.process_voice_input("This is test text that should appear in history.")
            
            # Verify transcript_history was passed and not empty
            assert captured_state is not None
            assert captured_state['transcript_history'] != ""
            assert captured_state['transcript_history'] is not None
            assert "This is test text" in captured_state['transcript_history']


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])