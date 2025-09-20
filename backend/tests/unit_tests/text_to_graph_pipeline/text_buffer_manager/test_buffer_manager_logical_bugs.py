"""
Tests for potential logical bugs in TextBufferManager
"""


from backend.text_to_graph_pipeline.text_buffer_manager.buffer_manager import \
    TextBufferManager


class TestTextBufferManagerLogicalBugs:
    """Tests that expose potential logical issues in the buffer manager"""
    
    def test_buffer_not_cleared_after_get_buffer_text(self):
        """
        BUG: getBufferTextWhichShouldBeProcessed() returns buffer content but doesn't clear it.
        This could lead to duplicate processing if called multiple times.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=10)
        
        buffer_manager.addText("Hello World!")  # 12 chars, exceeds threshold
        
        # First call
        result1 = buffer_manager.getBufferTextWhichShouldBeProcessed()
        assert result1 == "Hello World!"
        
        # Second call - buffer wasn't cleared!
        result2 = buffer_manager.getBufferTextWhichShouldBeProcessed()
        assert result2 == "Hello World!"  # BUG: Returns same text again!
        
        # This could lead to duplicate processing
        
    def test_init_multiple_times_doesnt_reset_buffer(self):
        """
        BUG: Calling init() multiple times changes threshold but doesn't reset buffer.
        This could lead to unexpected behavior.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=20)
        
        buffer_manager.addText("Short")  # 5 chars, below threshold
        assert buffer_manager.getBufferTextWhichShouldBeProcessed() == ""
        
        # Change threshold to lower value
        buffer_manager.init(bufferFlushLength=3)
        
        # BUG: Buffer still contains "Short" and now exceeds new threshold
        result = buffer_manager.getBufferTextWhichShouldBeProcessed()
        assert result == "Short"  # This might be unexpected behavior
        
    def test_transcript_history_never_cleaned_after_flush(self):
        """
        BUG: Transcript history keeps growing even after text is flushed from buffer.
        This could lead to memory issues in long-running processes.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        
        # Add and flush text multiple times
        for i in range(5):
            buffer_manager.addText(f"Sentence {i}. ")
        
        # Flush some text
        buffer_manager.flushCompletelyProcessedText("Sentence 0.")
        buffer_manager.flushCompletelyProcessedText("Sentence 1.")
        
        # Transcript history still contains flushed text
        history = buffer_manager.get_transcript_history()
        assert "Sentence 0." in history  # Already flushed but still in history
        assert "Sentence 1." in history  # Already flushed but still in history
        
    def test_fuzzy_match_removes_wrong_text_silently(self):
        """
        BUG: Fuzzy matching might remove different text than requested without warning.
        This could lead to data corruption.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        
        buffer_manager.addText("The cat sat on the mat.")
        
        # Try to flush with a typo - fuzzy match will find it
        remaining = buffer_manager.flushCompletelyProcessedText("The cat sit on the mat.")  # noqa: F841
        
        # BUG: We asked to remove "sit" but it removed "sat" - silent data change!
        # The caller has no way to know that different text was removed
        
    def test_no_way_to_check_if_flush_will_succeed(self):
        """
        BUG: No way to check if text exists before flushing.
        Forces try/except pattern for normal flow control.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        
        buffer_manager.addText("Hello World")
        
        # No method like "canFlush(text)" or "contains(text)"
        # Must use try/except for flow control
        try:
            buffer_manager.flushCompletelyProcessedText("Goodbye World")
        except RuntimeError:
            # Using exceptions for normal flow control is bad practice
            pass
            
    def test_addtext_returns_void_hiding_buffer_state(self):
        """
        BUG: addText() returns void, so caller doesn't know if buffer is ready.
        This forces inefficient double-checking pattern.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=20)
        
        # Inefficient pattern forced by API:
        buffer_manager.addText("Hello")  # No return value
        if buffer_manager.getBufferTextWhichShouldBeProcessed():  # Must check separately
            # Process...
            pass
            
        buffer_manager.addText(" World! More text")  # Still no return value  
        if buffer_manager.getBufferTextWhichShouldBeProcessed():  # Check again
            # Process...
            pass
            
        # Better API would be: is_ready = buffer_manager.addText("Hello")
        
    def test_buffer_and_transcript_can_desync(self):
        """
        BUG: Buffer and transcript history can get out of sync because empty text 
        is skipped for buffer but might still affect transcript.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        
        # Looking at the implementation, empty text is skipped in add_text
        # but the transcript history is updated before that check
        
        # This is actually handled correctly in the implementation,
        # but it's a risky design pattern
        
    def test_no_partial_buffer_flush(self):
        """
        BUG: No way to force processing of buffer below threshold.
        This could lose data on shutdown.
        """
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=100)
        
        buffer_manager.addText("Important data that needs to be saved")  # Below threshold
        
        # No way to force processing!
        result = buffer_manager.getBufferTextWhichShouldBeProcessed()
        assert result == ""  # BUG: Can't get partial buffer on shutdown
        
        # The data is trapped in the buffer with no way to extract it
        # except by adding more text or calling private methods
        
    def test_fuzzy_threshold_vs_buffer_threshold_confusion(self):
        """
        BUG: Two different thresholds (buffer size and fuzzy match %) are both important
        but unrelated. This is confusing and error-prone.
        """
        buffer_manager = TextBufferManager()
        # This is flush threshold in characters
        buffer_manager.init(bufferFlushLength=80)  
        
        # But internally fuzzy matcher uses 0.8 (80%) similarity threshold
        # These two 80s are completely unrelated but could be confused
        
        buffer_manager.addText("A" * 79)  # Just below flush threshold
        assert buffer_manager.getBufferTextWhichShouldBeProcessed() == ""
        
        buffer_manager.addText("B")  # This adds space + B = 81 total chars (space added between A and B)
        assert len(buffer_manager.getBufferTextWhichShouldBeProcessed()) == 81
        
    def test_long_text_flush_performance_issue(self):
        """
        BUG: Fuzzy matching on very long texts could be extremely slow.
        Already discovered this times out, but it's a design flaw.
        """
        # Already found this in edge case testing - fuzzy matcher is O(n²) or worse
        pass
        
    def test_concurrent_access_not_thread_safe(self):
        """
        BUG: No thread safety mechanisms. Concurrent access could corrupt state.
        """
        # Would need threading to test properly, but the code has no locks/synchronization
        # This is a critical bug for production use
        pass