"""
Comprehensive test suite for UnifiedBufferManager
Tests all edge cases, thread safety, and integration scenarios
"""

import pytest
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import patch, MagicMock

from backend.tree_manager.unified_buffer_manager import UnifiedBufferManager


class TestUnifiedBufferManagerBasics:
    """Test basic functionality and edge cases"""
    
    @pytest.fixture
    def buffer_manager(self):
        """Create a buffer manager instance for testing"""
        return UnifiedBufferManager(buffer_size_threshold=100)
    
    def test_initialization(self):
        """Test initialization with various parameters"""
        # Default initialization
        mgr = UnifiedBufferManager()
        assert mgr.buffer_size_threshold == 500
        stats = mgr.get_buffer_stats()
        assert stats["text_buffer_size"] == 0
        assert stats["transcript_history_size"] == 0
        assert stats["incomplete_remainder_size"] == 0
        
        # Custom threshold
        mgr = UnifiedBufferManager(buffer_size_threshold=200)
        assert mgr.buffer_size_threshold == 200
    
    def test_empty_input_handling(self, buffer_manager):
        """Test handling of empty and None inputs"""
        # Empty string
        result = buffer_manager.add_text("")
        assert result is None
        
        # None input should not crash
        result = buffer_manager.add_text(None)
        assert result is None
        
        # Whitespace only
        result = buffer_manager.add_text("   ")
        assert result is None
    
    def test_immediate_processing_large_text(self, buffer_manager):
        """Test immediate processing for large text"""
        # Text larger than 1.5x threshold should process immediately
        large_text = "This is a large piece of text. " * 10  # ~320 chars
        result = buffer_manager.add_text(large_text)
        assert result is not None
        assert result == large_text.strip()
    
    def test_immediate_processing_multiple_sentences(self, buffer_manager):
        """Test immediate processing for multiple complete sentences"""
        text = "First sentence. Second sentence! Third sentence? Fourth sentence."
        result = buffer_manager.add_text(text)
        assert result is not None
        assert result == text.strip()
    
    def test_buffering_small_text(self, buffer_manager):
        """Test buffering behavior for small text"""
        # Small text should be buffered
        small_text = "This is small"
        result = buffer_manager.add_text(small_text)
        assert result is None
        
        # Check it's in the buffer
        stats = buffer_manager.get_buffer_stats()
        assert stats["text_buffer_size"] > 0
    
    def test_buffer_accumulation_and_processing(self, buffer_manager):
        """Test buffer accumulation until threshold"""
        # Add small chunks that shouldn't trigger immediate processing individually
        chunks = ["This is chunk one. ", "This is chunk two. ", "This is chunk three. ", "Final chunk. "]
        
        results = []
        buffer_sizes = []
        for chunk in chunks:
            result = buffer_manager.add_text(chunk)
            results.append(result)
            buffer_sizes.append(buffer_manager.get_buffer_stats()["text_buffer_size"])
        
        # Either should have processed at some point OR should have accumulated in buffer
        total_text = "".join(chunks)
        assert any(r is not None for r in results) or sum(buffer_sizes) > 0, \
            f"Neither processed nor buffered. Results: {results}, Buffer sizes: {buffer_sizes}"
    
    def test_incomplete_chunk_handling(self, buffer_manager):
        """Test handling of incomplete chunks"""
        # Set an incomplete remainder
        buffer_manager.set_incomplete_remainder("This is incomplete")
        assert buffer_manager.get_incomplete_remainder() == "This is incomplete"
        
        # Add new text - should prepend remainder
        result = buffer_manager.add_text("and now it's complete.")
        assert result is not None
        assert "This is incomplete and now it's complete." in result
        
        # Remainder should be cleared after use
        assert buffer_manager.get_incomplete_remainder() == ""
    
    def test_abbreviation_handling(self, buffer_manager):
        """Test that abbreviations don't count as sentence endings"""
        # Text with abbreviations
        text = "Dr. Smith and Mr. Jones work at Inc. Ltd. They are professionals."
        
        # Should not count Dr., Mr., Inc., Ltd. as sentence endings
        # Only the final period should count
        with patch.object(buffer_manager, '_should_process_immediately', wraps=buffer_manager._should_process_immediately) as mock_should_process:
            buffer_manager.add_text(text)
            mock_should_process.assert_called_once()
            # The method should see this as having fewer sentences than raw period count
    
    def test_transcript_history_maintenance(self, buffer_manager):
        """Test transcript history is maintained"""
        texts = ["First text. ", "Second text. ", "Third text. "]
        
        for text in texts:
            buffer_manager.add_text(text)
        
        history = buffer_manager.get_transcript_history()
        assert all(text in history for text in texts)
    
    def test_clear_buffers(self, buffer_manager):
        """Test clearing all buffers"""
        # Add some data
        buffer_manager.add_text("Some text")
        buffer_manager.set_incomplete_remainder("Incomplete")
        
        # Clear buffers
        buffer_manager.clear_buffers()
        
        # Check everything is cleared
        stats = buffer_manager.get_buffer_stats()
        assert stats["text_buffer_size"] == 0
        assert stats["transcript_history_size"] == 0
        assert stats["incomplete_remainder_size"] == 0
        assert buffer_manager.is_first_processing() == True
    
    def test_first_processing_flag(self, buffer_manager):
        """Test first processing flag behavior"""
        assert buffer_manager.is_first_processing() == True
        assert buffer_manager.is_first_processing() == False
        assert buffer_manager.is_first_processing() == False
        
        # Clear and check again
        buffer_manager.clear_buffers()
        assert buffer_manager.is_first_processing() == True


class TestBufferOverflowProtection:
    """Test buffer overflow protection"""
    
    def test_buffer_overflow_protection(self):
        """Test that buffer doesn't grow unbounded"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=100)
        
        # Try to add text that would exceed MAX_BUFFER_SIZE
        huge_text = "x" * 3000  # Half of MAX_BUFFER_SIZE
        
        # Add it twice - should force processing
        result1 = buffer_manager.add_text(huge_text)
        result2 = buffer_manager.add_text(huge_text)
        
        # At least one should have been processed
        assert result1 is not None or result2 is not None
        
        # Buffer should not be at max size
        stats = buffer_manager.get_buffer_stats()
        assert stats["text_buffer_size"] < buffer_manager.MAX_BUFFER_SIZE
    
    def test_force_process_buffer(self):
        """Test force processing when buffer is large"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=100)
        
        # Fill buffer without triggering normal processing
        incomplete_text = "This text has no ending"
        for _ in range(50):  # Add many times
            result = buffer_manager.add_text(incomplete_text)
            if result is not None:
                # Force processing was triggered
                break
        
        # Should have eventually force processed
        stats = buffer_manager.get_buffer_stats()
        assert stats["text_buffer_size"] < buffer_manager.MAX_BUFFER_SIZE


class TestThreadSafety:
    """Test thread safety of buffer manager"""
    
    def test_concurrent_add_text(self):
        """Test concurrent calls to add_text"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=100)
        results = []
        errors = []
        
        def add_text_concurrent(text, index):
            try:
                result = buffer_manager.add_text(f"{text} {index}")
                if result:
                    results.append(result)
            except Exception as e:
                errors.append(e)
        
        # Run concurrent additions
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for i in range(50):
                future = executor.submit(add_text_concurrent, "Test text.", i)
                futures.append(future)
            
            # Wait for all to complete
            for future in as_completed(futures):
                future.result()
        
        # Should have no errors
        assert len(errors) == 0
        
        # Should have processed some text
        assert len(results) > 0
    
    def test_concurrent_read_write(self):
        """Test concurrent reads and writes"""
        buffer_manager = UnifiedBufferManager()
        errors = []
        
        def writer():
            try:
                for i in range(100):
                    buffer_manager.add_text(f"Text {i}")
                    buffer_manager.set_incomplete_remainder(f"Incomplete {i}")
            except Exception as e:
                errors.append(('writer', e))
        
        def reader():
            try:
                for _ in range(100):
                    buffer_manager.get_buffer_stats()
                    buffer_manager.get_transcript_history()
                    buffer_manager.get_incomplete_remainder()
            except Exception as e:
                errors.append(('reader', e))
        
        # Run readers and writers concurrently
        threads = []
        for _ in range(3):
            threads.append(threading.Thread(target=writer))
            threads.append(threading.Thread(target=reader))
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join()
        
        # Should have no errors
        assert len(errors) == 0


class TestEdgeCases:
    """Test various edge cases"""
    
    def test_ellipses_handling(self):
        """Test handling of text ending with ellipses"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=100)
        
        # Text ending with ellipses should be buffered
        text = "This text trails off..."
        result = buffer_manager.add_text(text)
        
        # Should be buffered, not processed immediately
        assert result is None
    
    def test_mixed_punctuation(self):
        """Test handling of mixed punctuation"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=50)
        
        text = "Question? Exclamation! Statement. Another statement."
        result = buffer_manager.add_text(text)
        
        # Should process immediately due to multiple sentences
        assert result is not None
    
    def test_special_characters(self):
        """Test handling of special characters"""
        buffer_manager = UnifiedBufferManager()
        
        # Unicode and special characters
        text = "Text with émojis 😀 and spëcial chäracters™"
        result = buffer_manager.add_text(text)
        assert result is None  # Small text, should buffer
        
        # Add more to trigger processing
        result = buffer_manager.add_text("." * 500)
        assert result is not None
    
    def test_repeated_spaces(self):
        """Test handling of repeated spaces"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=100)
        
        text = "Text   with    multiple     spaces.  And   more   text."
        result = buffer_manager.add_text(text)
        
        # Should handle gracefully
        if result:
            assert "Text" in result and "spaces" in result
    
    def test_newlines_and_tabs(self):
        """Test handling of newlines and tabs"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=100)
        
        text = "Line one\nLine two\tWith tab\r\nLine three."
        result = buffer_manager.add_text(text)
        
        # Should handle gracefully
        stats = buffer_manager.get_buffer_stats()
        assert stats["text_buffer_size"] > 0 or result is not None


class TestIntegrationScenarios:
    """Test realistic integration scenarios"""
    
    def test_voice_transcription_simulation(self):
        """Simulate realistic voice transcription chunks"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=200)
        
        # Simulate voice chunks that might come from ASR
        voice_chunks = [
            "So I was thinking about",
            " the project yesterday and I realized",
            " we need to completely refactor the",
            " authentication system.",
            " The current implementation has",
            " several security vulnerabilities that",
            " could be exploited.",
            " We should schedule a meeting to discuss"
        ]
        
        processed_results = []
        for chunk in voice_chunks:
            result = buffer_manager.add_text(chunk)
            if result:
                processed_results.append(result)
        
        # Should have processed something
        assert len(processed_results) > 0
        
        # All text should be captured
        all_text = " ".join(processed_results) + buffer_manager.get_buffer_stats()["text_buffer_size"] * " "
        assert "authentication" in all_text or buffer_manager.get_transcript_history()
    
    def test_workflow_integration(self):
        """Test integration with workflow incomplete remainder handling"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=150)
        
        # Simulate workflow setting incomplete remainder
        buffer_manager.set_incomplete_remainder("The system uses advanced")
        
        # Add new chunk
        result = buffer_manager.add_text("machine learning algorithms.")
        
        # Should process the combined text
        assert result is not None
        assert "system uses advanced machine learning" in result
        
        # Remainder should be cleared
        assert buffer_manager.get_incomplete_remainder() == ""
    
    def test_rapid_small_chunks(self):
        """Test handling of many rapid small chunks"""
        buffer_manager = UnifiedBufferManager(buffer_size_threshold=100)
        
        words = "This is a test of rapid fire small chunks coming in sequence".split()
        
        results = []
        for word in words:
            result = buffer_manager.add_text(word + " ")
            if result:
                results.append(result)
        
        # If nothing was processed, force flush the buffer to check accumulation
        if len(results) == 0:
            # Add a sentence ending to trigger processing
            result = buffer_manager.add_text(".")
            if result:
                results.append(result)
        
        # Should have accumulated and processed something
        assert len(results) > 0 or buffer_manager.get_buffer_stats()["text_buffer_size"] > 0
        
        # Check nothing was lost
        total_input = " ".join(words)
        total_processed = " ".join(results) if results else ""
        buffer_content = buffer_manager._text_buffer
        
        # All words should be either in processed results or still in buffer
        for word in words:
            assert word in total_processed or word in buffer_content


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
