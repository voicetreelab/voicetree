"""
Main Text Buffer Manager implementation
Provides a clean interface for text buffering and chunk processing
"""

import logging
import re
from typing import Optional

from backend.text_to_graph_pipeline.text_buffer_manager.fuzzy_text_matcher import (
    FuzzyTextMatcher,
)


class TextBufferManager:
    """
    Simplified buffer manager for text accumulation with character-based thresholding.

    This is a streamlined version that uses straightforward character counting
    instead of complex sentence extraction.

    Features:
    - Character-based threshold (default 83 chars)
    - Maintains transcript history
    - Immediate processing for text above threshold
    - Clear and simple implementation

    IMPORTANT: This buffer manager intentionally does NOT implement:
    - Sentence-based immediate processing (min_sentences_for_immediate is ignored)
    - Incomplete chunk remainder prepending (stored but not used in buffering)
    - Complex sentence extraction logic

    These features were removed because:
    1. The agentic pipeline already handles sentence boundaries intelligently
    2. Character-based buffering is simpler and more predictable
    3. The workflow adapter manages incomplete chunks at a higher level
    4. Adding this complexity provides no benefit and makes the system harder to maintain

    If you're tempted to add these features back, please read buffer_manager_analysis_report.md first.
    """

    def __init__(self) -> None:
        """
        Initialize the buffer manager.
        """
        self._buffer = ""
        self._is_first_processing = True
        self._fuzzy_matcher = FuzzyTextMatcher(similarity_threshold=80)
        self.bufferFlushLength = 0  # Will be set by init() method, #TODO AWFUL

    def _clean_buffer_text(self, text: str) -> str:
        """Remove double spaces and strip whitespace from buffer text"""
        # Replace multiple spaces with single space
        cleaned = re.sub(r' +', ' ', text)
        return cleaned.strip()

    def init(self, bufferFlushLength: int) -> None:
        """Initialize with a specific buffer flush length"""
        self.bufferFlushLength = bufferFlushLength
        logging.info(f"TextBufferManager initialized with threshold: {self.bufferFlushLength}")

    def addText(self, text: str) -> None:
        if not text or text.strip() == "":
            logging.warning("addText called empty text")
            return

        # add space between phrases.
        # only if previous phrase ended in an alphabetical character AND new text starts with alphabetical character.
        if self._buffer and not text[0] == " " and self._buffer[-1].isalpha() and text[0].isalpha():
            self._buffer += " "

        # Add to buffer only (history updated after successful flush)
        self._buffer += text

        logging.debug(f"Added '{text}' to buffer. Buffer size: {len(self._buffer)}")

    def getBufferTextWhichShouldBeProcessed(self) -> str:
        """Get buffer text if it should be processed, otherwise empty string"""
        if len(self._buffer) >= self.bufferFlushLength:
            return self._buffer
        return ""

    def flushCompletelyProcessedText(self, text: str) -> str:
        logging.info(f"current buffer before flushing: {self._buffer}")

        """Remove processed text from buffer and return remaining contents"""
        if not text:
            logging.debug("No completed text to flush")
            return self._buffer

        if not self._buffer:
            logging.warning("flushCompletelyProcessedText called with empty buffer")
            return self._buffer

        if text in self._buffer:
            self._buffer = self._clean_buffer_text(self._buffer.replace(text, "", 1))
            return self._buffer
        # Use fuzzy matcher to remove the text
        result, success = self._fuzzy_matcher.remove_matched_text(self._buffer, text)

        if success:
            self._buffer = self._clean_buffer_text(result)
            logging.info(f"Successfully flushed completed text, Remaining buffer content: {self._buffer}")
        else:
            # TODO: Add more robust error handling here for production
            # For now, crash during development to catch issues
            match = self._fuzzy_matcher.find_best_match(text, self._buffer)
            best_score = match[2] if match else 0

            # Show more detail for debugging
            completed_preview = text[:200] + ("..." if len(text) > 200 else "")
            buffer_preview = self._buffer[:200] + ("..." if len(self._buffer) > 200 else "")

            error_msg = (f"Failed to find completed text in buffer. "
                        f"Best similarity was only {best_score:.0f}%. This indicates a system issue.\n"
                        f"Completed text ({len(text)} chars): '{completed_preview}'\n"
                        f"Buffer content ({len(self._buffer)} chars): '{buffer_preview}'")
            logging.error(error_msg)

            # Additional debug info
            if text[:50] == self._buffer[:50]:
                logging.error("Note: Texts have same start (first 50 chars)")
                if self._buffer.startswith(text):
                    logging.error("Buffer starts with completed text - this should have been found!")
                elif text in self._buffer:
                    idx = self._buffer.index(text)
                    logging.error(f"Completed text found in buffer at position {idx}")
                else:
                    logging.error("Completed text is NOT a substring of buffer")
                    # Find where they diverge
                    for i in range(min(len(text), len(self._buffer))):
                        if i >= len(text) or i >= len(self._buffer) or text[i] != self._buffer[i]:
                            logging.error(f"First difference at position {i}")
                            if i < len(text) and i < len(self._buffer):
                                logging.error(f"Completed[{i}]: '{text[i]}' (ord={ord(text[i])})")
                                logging.error(f"Buffer[{i}]: '{self._buffer[i]}' (ord={ord(self._buffer[i])})")
                            break

            raise RuntimeError(error_msg)

        return self._buffer

    def getBuffer(self) -> str:
        """Get current buffer content (new API)"""
        return self._buffer

    def clear(self) -> None:
        """Clear all buffers and reset state"""
        self._buffer = ""
        self._is_first_processing = True
        logging.info("Cleared all buffers")

    # Compatibility properties and methods
    @property
    def _text_buffer(self) -> str:
        """Compatibility property for tests accessing _text_buffer directly"""
        return self._buffer

    @_text_buffer.setter
    def _text_buffer(self, value: str) -> None:
        """Compatibility setter for tests"""
        self._buffer = value

    def get_buffer(self) -> str:
        """Compatibility method for old API - delegates to getBuffer()"""
        return self.getBuffer()
