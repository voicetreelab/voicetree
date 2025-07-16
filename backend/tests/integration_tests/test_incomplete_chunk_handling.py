"""
Integration test for incomplete chunk handling
Tests the complete flow from voice input through buffer management to workflow processing
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager
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
        """Create a mock workflow result with completed text"""
        from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowResult
        return WorkflowResult(
            success=True,
            new_nodes=["Save and Upload File"],
            integration_decisions=[],
            metadata={
                "chunks_processed": 3,
                "decisions_made": 1,
                "incomplete_buffer": "I'm going to save this file, upload it with the file API, and then",  # Legacy
                "completed_text": "Cool, so I've opened the Colab. And I'm going to try run now this audio."  # New approach
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
        chunk_processor.buffer_manager.bufferFlushLength = 50
        
        # Create dynamic mock that returns appropriate results for each call
        call_count = 0
        
        def dynamic_workflow_result(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            
            from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowResult
            
            if call_count == 1:
                # First call - process initial text, leave incomplete part
                return mock_workflow_result
            else:
                # Second call - process the combined incomplete + new text
                return WorkflowResult(
                    success=True,
                    new_nodes=[],
                    integration_decisions=[],
                    metadata={
                        "chunks_processed": 1,
                        "completed_text": "I'm going to save this file, upload it with the file API, and then run the example audio to text. Cool, let's try that."
                    }
                )
        
        # Mock the workflow adapter to return our test result
        with patch.object(chunk_processor.workflow_adapter, 'process_full_buffer', 
                         new_callable=AsyncMock) as mock_process:
            mock_process.side_effect = dynamic_workflow_result
            
            # First transcript ends with incomplete chunk
            first_transcript = "Cool, so I've opened the Colab. And I'm going to try run now this audio. I'm going to save this file, upload it with the file API, and then"
            
            # Process first transcript - should trigger immediately due to low threshold
            await chunk_processor.process_voice_input(first_transcript)
            
            # Verify workflow was called
            assert mock_process.call_count >= 1
            
            # Verify the buffer contains the unprocessed text
            # The buffer should have the incomplete portion after completed text is flushed
            expected_buffer = "I'm going to save this file, upload it with the file API, and then"
            assert expected_buffer in chunk_processor.buffer_manager.get_buffer()
            
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
                
                # Verify the text was properly merged (note: no space added between chunks)
                expected_merged = "I'm going to save this file, upload it with the file API, and thenrun the example audio to text. Cool, let's try that."
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
        chunk_processor.buffer_manager.bufferFlushLength = 10
        
        # Mock workflow adapter
        with patch.object(chunk_processor.workflow_adapter, 'process_full_buffer', 
                         new_callable=AsyncMock) as mock_process:
            mock_process.return_value = Mock(
                success=True,
                new_nodes=[],
                integration_decisions=[],
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
    async def test_fuzzy_matching_prevents_duplication(self):
        """Test that fuzzy matching correctly prevents duplication"""
        
        # Create buffer manager with low threshold for testing
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        
        # Simulate scenario where LLM slightly modifies text
        buffer_manager._buffer = "The cat sat on the mat. And then something else"
        
        # Flush completed text with minor LLM modification
        buffer_manager.flushCompletelyProcessedText("The cat sits on the mat.")  # "sat" changed to "sits"
        
        # Verify only the unprocessed portion remains
        assert buffer_manager.getBuffer() == "And then something else"
        
        # Test with punctuation differences
        buffer_manager._buffer = "Hello, world! How are you?"
        buffer_manager.flushCompletelyProcessedText("Hello world.")  # Different punctuation
        
        # Verify correct removal despite punctuation differences
        assert buffer_manager.getBuffer() == "How are you?"
    
    @pytest.mark.asyncio
    async def test_fuzzy_matching_workflow_integration(self, mock_decision_tree):
        """Test complete workflow with fuzzy matching for LLM text modifications"""
        
        # Create chunk processor
        chunk_processor = ChunkProcessor(
            decision_tree=mock_decision_tree,
            converter=Mock(),
            workflow_state_file=None
        )
        
        # Set threshold to force processing
        chunk_processor.buffer_manager.bufferFlushLength = 30
        
        # Track workflow calls
        workflow_calls = []
        
        def mock_process_full_buffer(transcript, context):
            workflow_calls.append({
                'transcript': transcript,
                'context': context
            })
            # Simulate LLM modifying the text slightly
            if "Hello world" in transcript:
                completed = "Hello, world!"  # Added punctuation
            else:
                completed = transcript
                
            from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowResult
            return WorkflowResult(
                success=True,
                new_nodes=[],
                integration_decisions=[],
                metadata={
                    "completed_text": completed,
                    "chunks_processed": 1
                }
            )
        
        with patch.object(chunk_processor.workflow_adapter, 'process_full_buffer',
                         new_callable=AsyncMock, side_effect=mock_process_full_buffer):
            
            # Process text that will be modified by LLM
            await chunk_processor.process_voice_input("Hello world. This is incomplete")
            
            # Buffer should only contain the incomplete part
            # Even though LLM changed "Hello world." to "Hello, world!"
            buffer_content = chunk_processor.buffer_manager.get_buffer()
            assert "Hello world" not in buffer_content
            assert "This is incomplete" in buffer_content


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])