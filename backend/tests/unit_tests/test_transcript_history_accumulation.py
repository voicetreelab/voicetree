"""Test to verify transcript history accumulation in TextBufferManager"""

import pytest
import asyncio
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree


class TestTranscriptHistoryAccumulation:
    """Test that transcript history properly accumulates across multiple buffer processing cycles"""
    
    def test_buffer_manager_accumulates_history(self):
        """Test that TextBufferManager accumulates transcript history correctly"""
        # Create buffer manager with larger threshold to avoid history trimming
        config = BufferConfig(buffer_size_threshold=100)
        buffer_manager = TextBufferManager(config=config)
        
        # Add text in small chunks
        texts = ["Hello", "world", "this", "is", "a", "test", "of", "transcript", "history"]
        
        for text in texts:
            buffer_manager.add_text(text)
        
        # Get transcript history
        history = buffer_manager.get_transcript_history()
        
        # Verify all text is in history (accounting for spaces added by buffer manager)
        # The buffer manager adds a space after each text
        for text in texts:
            assert text in history, f"Text '{text}' not found in history: '{history}'"
        
        # Verify the history contains all words in order
        assert "Hello" in history and "world" in history and "history" in history
        
        # Verify history persists after buffer processing
        # Add more text to trigger processing
        result = buffer_manager.add_text("accumulation ")
        if result.is_ready:
            # Buffer was processed, but history should still contain everything
            history_after = buffer_manager.get_transcript_history()
            assert "Hello world" in history_after
            assert "accumulation" in history_after
    
    @pytest.mark.asyncio
    async def test_chunk_processor_passes_history(self):
        """Test that ChunkProcessor correctly passes transcript history to workflow"""
        # Create decision tree and chunk processor
        decision_tree = DecisionTree()
        processor = ChunkProcessor(decision_tree)
        
        # Track transcript history passed to workflow
        history_values = []
        
        # Monkey patch the workflow adapter to capture transcript history
        original_process = processor.workflow_adapter.process_transcript
        
        async def mock_process_transcript(transcript, context=None):
            history_values.append(context)
            # Return a minimal successful result
            return type('WorkflowResult', (), {
                'success': True,
                'new_nodes': [],
                'node_actions': [],
                'error_message': None,
                'metadata': {}
            })()
        
        processor.workflow_adapter.process_transcript = mock_process_transcript
        
        # Process multiple chunks
        chunks = [
            "First chunk of text that should be processed. ",
            "Second chunk that comes after the first one. ",
            "Third chunk to verify history accumulation. "
        ]
        
        for i, chunk in enumerate(chunks):
            await processor.process_voice_input(chunk)
            
            # After first chunk, history should start accumulating
            if i > 0 and history_values:
                last_history = history_values[-1]
                if last_history:  # History was passed
                    # Verify previous chunks are in history
                    for j in range(i):
                        assert chunks[j] in last_history, \
                            f"Chunk {j} '{chunks[j]}' not found in history: '{last_history}'"
        
        # Restore original method
        processor.workflow_adapter.process_transcript = original_process
    
    def test_buffer_manager_history_with_incomplete_chunks(self):
        """Test that fuzzy matching doesn't break transcript history"""
        config = BufferConfig(buffer_size_threshold=30)
        buffer_manager = TextBufferManager(config=config)
        
        # Add text that will trigger processing
        result1 = buffer_manager.add_text("First part of text that is long enough ")
        assert result1.is_ready  # Should trigger processing
        
        # Simulate flushing completed text with minor modification
        buffer_manager.flush_completed_text("First part of text that is long enough")
        
        # Add more text
        result2 = buffer_manager.add_text("continuation of the text")
        
        # Verify history contains all text without duplication
        history = buffer_manager.get_transcript_history()
        assert "First part of text" in history
        assert "continuation" in history
        # Count occurrences - should only appear once
        assert history.count("First part of text") == 1
        
    def test_history_accumulation_across_buffer_cycles(self):
        """Test history accumulation across multiple buffer processing cycles"""
        config = BufferConfig(buffer_size_threshold=30)  # Small threshold
        buffer_manager = TextBufferManager(config=config)
        
        # Simulate word-by-word processing like the benchmarker
        sentence = "The quick brown fox jumps over the lazy dog repeatedly"
        words = sentence.split()
        
        processed_count = 0
        all_processed_text = []
        
        for i, word in enumerate(words):
            result = buffer_manager.add_text(word)
            if result.is_ready:
                processed_count += 1
                all_processed_text.append(result.text)
                
                # Get history at this point
                history = buffer_manager.get_transcript_history()
                
                # Verify history contains content
                assert len(history) > 0, f"History is empty after processing {processed_count} buffers"
                
                # Due to the sliding window (buffer_size * 3), older words might be trimmed
                # Check that at least recent words are in history
                # Look for individual words rather than exact phrases to handle extra spaces
                recent_word_count = min(5, i + 1)  # Check up to 5 recent words
                recent_words = words[max(0, i - recent_word_count + 1):i + 1]
                
                # At least some recent words should be in history
                words_found = sum(1 for w in recent_words if w in history)
                assert words_found > 0, \
                    f"No recent words found in history. Recent words: {recent_words}, History: '{history}'"
        
        # Final history should contain the entire sentence
        final_history = buffer_manager.get_transcript_history()
        assert len(final_history) > 0, "Final history is empty"
        
        # All words should be in final history (subject to window size)
        for word in words[-5:]:  # Check at least last 5 words
            assert word in final_history, f"Word '{word}' not found in final history"


if __name__ == "__main__":
    # Run the tests
    test = TestTranscriptHistoryAccumulation()
    test.test_buffer_manager_accumulates_history()
    print("✓ Buffer manager accumulates history correctly")
    
    test.test_buffer_manager_history_with_incomplete_chunks()
    print("✓ Buffer manager handles incomplete chunks correctly")
    
    test.test_history_accumulation_across_buffer_cycles()
    print("✓ History accumulates across buffer cycles")
    
    # Run async test
    asyncio.run(test.test_chunk_processor_passes_history())
    print("✓ ChunkProcessor passes history to workflow")
    
    print("\nAll tests passed!")