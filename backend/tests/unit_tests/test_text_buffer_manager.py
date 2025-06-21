"""
Unit tests for TextBufferManager
"""

import pytest
from backend.text_to_graph_pipeline.text_buffer_manager import TextBufferManager, BufferConfig


class TestTextBufferManager:
    """Test suite for TextBufferManager"""
    
    def test_initialization(self):
        """Test buffer manager initialization"""
        config = BufferConfig(buffer_size_threshold=100)
        manager = TextBufferManager(config=config)
        
        assert manager.config.buffer_size_threshold == 100
        assert manager.get_transcript_history() == ""
        assert manager.is_first_processing() == True
        assert manager.is_first_processing() == False  # Second call should be False
    
    def test_immediate_processing_large_text(self):
        """Test immediate processing for large text"""
        config = BufferConfig(
            buffer_size_threshold=50,
            immediate_processing_size_multiplier=1.5
        )
        manager = TextBufferManager(config=config)
        
        # Text larger than threshold * multiplier (50 * 1.5 = 75)
        large_text = "This is a very long text that exceeds the threshold for immediate processing."
        result = manager.add_text(large_text)
        
        assert result.is_ready == True
        assert result.text == large_text
    
    def test_immediate_processing_multiple_sentences(self):
        """Test immediate processing for multiple sentences"""
        config = BufferConfig(
            buffer_size_threshold=100,
            min_sentences_for_immediate=3
        )
        manager = TextBufferManager(config=config)
        
        # Text with 3 sentences
        text = "First sentence. Second sentence. Third sentence."
        result = manager.add_text(text)
        
        assert result.is_ready == True
        assert result.text == text
    
    def test_buffered_processing(self):
        """Test buffered processing for small chunks"""
        config = BufferConfig(buffer_size_threshold=50)
        manager = TextBufferManager(config=config)
        
        # Add small chunks without complete sentences
        result1 = manager.add_text("This is")
        assert result1.is_ready == False
        
        result2 = manager.add_text("a test")
        assert result2.is_ready == False
        
        # Add more to create a complete sentence and exceed threshold
        result3 = manager.add_text("of the buffering system that should trigger processing.")
        assert result3.is_ready == True
        # The buffer extracts complete sentences, so it should contain the complete sentence
        assert result3.text == "of the buffering system that should trigger processing."
    
    def test_incomplete_remainder_handling(self):
        """Test handling of incomplete chunk remainder"""
        config = BufferConfig(buffer_size_threshold=100)  # Higher threshold
        manager = TextBufferManager(config=config)
        
        # Set incomplete remainder
        manager.set_incomplete_remainder("Previously incomplete")
        
        # Add new text that creates a complete sentence
        result = manager.add_text("text that continues with more content to exceed the threshold for processing.")
        
        # Should be processed due to exceeding threshold
        assert result.is_ready == True
        assert "Previously incomplete text that continues with more content to exceed the threshold for processing." in result.text
    
    def test_transcript_history(self):
        """Test transcript history tracking"""
        config = BufferConfig(
            buffer_size_threshold=30,
            transcript_history_multiplier=2
        )
        manager = TextBufferManager(config=config)
        
        # Add text
        manager.add_text("First chunk.")
        manager.add_text("Second chunk.")
        
        history = manager.get_transcript_history()
        assert "First chunk." in history
        assert "Second chunk." in history
    
    def test_clear_buffers(self):
        """Test clearing all buffers"""
        manager = TextBufferManager()
        
        # Add some data
        manager.add_text("Some text")
        manager.set_incomplete_remainder("Incomplete")
        
        # Clear
        manager.clear()
        
        # Verify cleared
        assert manager.get_transcript_history() == ""
        assert manager._text_buffer == ""
        assert manager._incomplete_chunk_remainder == ""
        assert manager.is_first_processing() == True
    
    def test_buffer_stats(self):
        """Test buffer statistics"""
        manager = TextBufferManager()
        
        manager.add_text("Test text")
        stats = manager.get_stats()
        
        assert "text_buffer_size" in stats
        assert "transcript_history_size" in stats
        assert "incomplete_remainder_size" in stats
        assert "buffer_threshold" in stats
        assert "is_first" in stats
    
    def test_empty_text_handling(self):
        """Test handling of empty text"""
        manager = TextBufferManager()
        
        result = manager.add_text("")
        assert result.is_ready == False
        
        result = manager.add_text(None)
        assert result.is_ready == False