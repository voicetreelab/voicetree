"""
Unit tests for TextBufferManager
"""

import pytest
import logging
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
        """Test that sentence-based immediate processing is not implemented in simplified buffer"""
        config = BufferConfig(
            buffer_size_threshold=100,
            min_sentences_for_immediate=3
        )
        manager = TextBufferManager(config=config)
        
        # Text with 3 sentences but under threshold - should NOT trigger
        text = "First sentence. Second sentence. Third sentence."
        result = manager.add_text(text)
        
        # Simplified buffer ignores min_sentences_for_immediate
        assert result.is_ready == False  # 49 chars < 100 threshold
    
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
        # The buffer returns all accumulated text when threshold is reached
        assert result3.text == "This isa testof the buffering system that should trigger processing."
    
    
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
        
        # Clear
        manager.clear()
        
        # Verify cleared
        assert manager.get_transcript_history() == ""
        assert manager._text_buffer == ""
        assert manager.is_first_processing() == True
    
    def test_buffer_stats(self):
        """Test buffer statistics"""
        manager = TextBufferManager()
        
        manager.add_text("Test text")
        stats = manager.get_stats()
        
        assert "text_buffer_size" in stats
        assert "transcript_history_size" in stats
        assert "buffer_threshold" in stats
        assert "is_first" in stats
    
    def test_empty_text_handling(self):
        """Test handling of empty text"""
        manager = TextBufferManager()
        
        result = manager.add_text("")
        assert result.is_ready == False
        
        result = manager.add_text(None)
        assert result.is_ready == False
        
        
    def test_flush_completed_text_basic(self):
        """Test basic flushing of completed text"""
        manager = TextBufferManager()
        
        # Add text to buffer
        manager._buffer = "Hello world. How are you?"
        
        # Flush completed text
        manager.flush_completed_text("Hello world.")
        
        # Buffer should only have remaining text
        assert manager.get_buffer() == "How are you?"
        
    def test_flush_completed_text_with_new_content(self):
        """Test that new content added during processing is preserved"""
        manager = TextBufferManager()
        
        # Initial buffer state
        manager._buffer = "Hello world. How are you today?"
        
        # Workflow processed only part of it
        manager.flush_completed_text("Hello world.")
        
        # Buffer should preserve the rest
        assert manager.get_buffer() == "How are you today?"
        
    def test_flush_completed_text_fuzzy_whitespace(self):
        """Test fuzzy matching handles whitespace differences"""
        manager = TextBufferManager()
        
        # Buffer has different whitespace
        manager._buffer = "Hello    world.   How are you?"
        
        # Completed text has normalized whitespace
        manager.flush_completed_text("Hello world.")
        
        # Should still match and remove correctly
        assert manager.get_buffer() == "How are you?"
        
        
    def test_flush_completed_text_not_found_raises(self):
        """Test that low similarity raises an error during development"""
        manager = TextBufferManager()
        
        # Buffer has some text
        manager._buffer = "Something completely different"
        
        # Try to flush text that doesn't exist in buffer
        # This should raise an error because similarity is too low
        with pytest.raises(RuntimeError) as excinfo:
            manager.flush_completed_text("Hello world")
        
        assert "Failed to find completed text in buffer" in str(excinfo.value)
        assert "Best similarity was only" in str(excinfo.value)
        
    def test_flush_completed_text_minor_llm_modifications(self):
        """Test fuzzy matching handles minor LLM modifications"""
        manager = TextBufferManager()
        
        # Test punctuation changes
        manager._buffer = "Hello, world! How are you?"
        manager.flush_completed_text("Hello world.")  # Different punctuation
        assert manager.get_buffer() == "How are you?"
        
        # Test minor word changes
        manager._buffer = "The cat sat on the mat. Next sentence."
        manager.flush_completed_text("The cat sits on the mat.")  # "sat" -> "sits"
        assert manager.get_buffer() == "Next sentence."
        
    def test_flush_completed_text_middle_of_buffer(self):
        """Test removing text from middle of buffer"""
        manager = TextBufferManager()
        
        # Buffer has unfinished text on both sides
        manager._buffer = "Still typing... The cat sat on the mat. And then we"
        
        # Flush the completed middle part
        manager.flush_completed_text("The cat sat on the mat.")
        
        # Should preserve both unfinished parts (normalized whitespace)
        assert " ".join(manager.get_buffer().split()) == "Still typing... And then we"
        
    def test_flush_completed_text_variable_length(self):
        """Test handling different length matches"""
        manager = TextBufferManager()
        
        # LLM slightly expanded text
        manager._buffer = "Hello my world. How are you?"
        manager.flush_completed_text("Hello world.")  # Missing "my"
        
        # Should still match with high similarity and remove the longer version
        assert manager.get_buffer() == "How are you?"
        
    def test_flush_completed_text_major_difference_raises(self):
        """Test that major differences raise an error"""
        manager = TextBufferManager()
        
        # Completely different text
        manager._buffer = "The quick brown fox jumps over the lazy dog."
        
        # Should raise because similarity is too low
        with pytest.raises(RuntimeError) as excinfo:
            manager.flush_completed_text("Hello world.")
            
        assert "Failed to find completed text" in str(excinfo.value)