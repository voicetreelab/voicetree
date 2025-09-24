"""
text_buffer_manager module provides the following API:

PUBLIC:
- init(bufferFlushLength)
- addText(text) -> void
- getBufferTextWhichShouldBeProcessed() -> buffer text or ""
- flushCompletelyProcessedText(text) -> remaining buffer contents
- get_transcript_history(maxLength:int) ->


PRIVATE:
- shouldBufferBeProcessed() -> boolean
- getBuffer() -> buffer text

"""


from backend.text_to_graph_pipeline.text_buffer_manager.buffer_manager import (
    TextBufferManager,
)


class TestTextBufferManager:
    """Test suite for TextBufferManager following TDD principles"""

    def test_init_with_buffer_flush_length(self):
        """Test that we can initialize with a bufferFlushLength parameter"""
        # This test will fail initially because the API doesn't match yet
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=100)
        assert hasattr(buffer_manager, 'bufferFlushLength')

    def test_add_text_returns_empty_until_threshold(self):
        """Test that addText returns empty string until bufferFlushLength is reached"""
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=20)  # Small threshold for testing

        # Add text below threshold
        buffer_manager.addText("Hello")  # 5 chars
        result = buffer_manager.getBufferTextWhichShouldBeProcessed()
        assert result == ""

        buffer_manager.addText(" world")  # 6 more chars, total 11
        result = buffer_manager.getBufferTextWhichShouldBeProcessed()
        assert result == ""

        # Add text to exceed threshold
        buffer_manager.addText(" testing")  # 8 more chars, total 19
        buffer_manager.addText("!")  # 1 more char, total 20
        result = buffer_manager.getBufferTextWhichShouldBeProcessed()
        assert result == "Hello world testing!"


    """
getBufferTextWhichShouldBeProcessed testable behaviours:
1. add words one at a time, getBufferTextWhichShouldBeProcessed() should return "" until bufferFlushLength is reached. Add more words and it should return the buffered text plus the new words.

2. flushCompletelyProcessedText(toRemove):
Given buffer below or above bufferFlushLength, buffer now = buffer - toRemove

should work for one word at start / middle / end of buffer. Should work for sentence at start / middle / end of buffer. Should work for a sentence that is 85% similar.

    - should only remove one instance of word / sentence, prefer earliest occurence if multiple matches.

    - multiple matches above 85% for a sentence should remove the one that is more similar, tie breaks by prefer earliest.
"""


    def test_flush_completely_processed_text_simple(self):
        """Test that flushCompletelyProcessedText removes text and returns remaining buffer"""
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)

        # Add some text
        buffer_manager.addText("The quick brown fox jumps over the lazy dog")

        # Flush part of the text
        remaining = buffer_manager.flushCompletelyProcessedText("The quick brown fox")
        # The fuzzy matcher may handle spaces differently, so let's check the content
        assert remaining.strip() == "jumps over the lazy dog"

        # Verify buffer state
        assert buffer_manager.getBuffer().strip() == "jumps over the lazy dog"

    def test_flush_with_fuzzy_matching(self):
        """Test that flushCompletelyProcessedText works with fuzzy matching (85% similar)"""
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)

        # Add original text
        buffer_manager.addText("The cat sat on the mat.")

        # Flush with slightly modified text (LLM might change "sat" to "sits")
        remaining = buffer_manager.flushCompletelyProcessedText("The cat sits on the mat.")

        # Should successfully remove the text despite the difference
        assert remaining.strip() == ""

    def test_flush_removes_only_first_occurrence(self):
        """Test that flush removes only the first occurrence when multiple matches exist"""
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=100)

        # Add text with repeated phrase
        buffer_manager.addText("Hello world. This is a test. Hello world again.")

        # Flush "Hello world" - should only remove first occurrence
        remaining = buffer_manager.flushCompletelyProcessedText("Hello world")

        # Should keep the second occurrence
        assert "Hello world again" in remaining
        assert remaining.strip().startswith(". This is a test")

    def test_get_transcript_history_with_max_length(self):
        """Test that get_transcript_history returns limited history based on maxLength"""
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)

        # Add text to build history
        buffer_manager.addText("First sentence.")
        buffer_manager.addText(" Second sentence.")
        buffer_manager.addText(" Third sentence.")
        buffer_manager.addText(" Fourth sentence.")

        # Get full history
        full_history = buffer_manager.get_transcript_history(maxLength=None)
        # Should not add unnecessary spaces
        assert full_history == "First sentence. Second sentence. Third sentence. Fourth sentence."

        # Get limited history
        limited_history = buffer_manager.get_transcript_history(maxLength=20)
        assert len(limited_history) <= 20
        # Should return the most recent characters
        assert "Fourth sentence" in limited_history

    def test_flush_word_at_different_positions(self):
        """Test removing a single word from start, middle, and end of buffer"""
        # Test word at start
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        buffer_manager.addText("Hello world this is a test")
        remaining = buffer_manager.flushCompletelyProcessedText("Hello")
        assert remaining.strip() == "world this is a test"

        # Test word in middle
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        buffer_manager.addText("Hello world this is a test")
        remaining = buffer_manager.flushCompletelyProcessedText("this")
        assert "Hello world" in remaining
        assert "is a test" in remaining

        # Test word at end
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=50)
        buffer_manager.addText("Hello world this is a test")
        remaining = buffer_manager.flushCompletelyProcessedText("test")
        assert "Hello world this is a" in remaining

    def test_flush_sentence_at_different_positions(self):
        """Test removing a sentence from start, middle, and end of buffer"""
        # Test sentence at start
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=100)
        buffer_manager.addText("First sentence. Second sentence. Third sentence.")
        remaining = buffer_manager.flushCompletelyProcessedText("First sentence.")
        assert remaining.strip() == "Second sentence. Third sentence."

        # Test sentence in middle
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=100)
        buffer_manager.addText("First sentence. Second sentence. Third sentence.")
        remaining = buffer_manager.flushCompletelyProcessedText("Second sentence.")
        assert "First sentence." in remaining
        assert "Third sentence." in remaining

    def test_flush_best_match_when_multiple_fuzzy_matches(self):
        """Test that when multiple matches are above 85%, the most similar is removed"""
        buffer_manager = TextBufferManager()
        buffer_manager.init(bufferFlushLength=150)

        # Add text with similar sentences
        buffer_manager.addText("The cat sat on the mat. The cat sits on the mat. The dog sat on the mat.")

        # Try to remove "The cat sits on the mat" - should match the exact one, not the similar one
        remaining = buffer_manager.flushCompletelyProcessedText("The cat sits on the mat.")

        # Should have removed the middle sentence (exact match), keeping the others
        assert "The cat sat on the mat." in remaining  # First sentence should remain
        assert "The dog sat on the mat." in remaining  # Last sentence should remain
        assert "The cat sits on the mat." not in remaining  # Middle should be removed


