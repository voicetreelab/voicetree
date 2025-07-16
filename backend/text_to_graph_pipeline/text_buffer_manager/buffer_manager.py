"""
Main Text Buffer Manager implementation
Provides a clean interface for text buffering and chunk processing
"""

import logging
from typing import Optional, Dict, Any

from .fuzzy_text_matcher import FuzzyTextMatcher


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
    
    def __init__(self):
        """
        Initialize the buffer manager.
        """
        self._buffer = ""
        self._transcript_history = ""
        self._is_first_processing = True
        self._fuzzy_matcher = FuzzyTextMatcher(similarity_threshold=0.8)
        self.bufferFlushLength = 0  # Will be set by init() method
        
    def init(self, bufferFlushLength: int) -> None:
        """Initialize with a specific buffer flush length"""
        self.bufferFlushLength = bufferFlushLength
        logging.info(f"TextBufferManager initialized with threshold: {self.bufferFlushLength}")
        
    def addText(self, text: str) -> None:
        """Add text to buffer (new API)"""
        # Skip empty or whitespace-only text
        if not text or not text.strip():
            logging.debug("Skipping empty/whitespace text")
            return
            
        # Add to transcript history immediately
        self._transcript_history += text
        logging.debug(f"[TRANSCRIPT_HISTORY] Added '{text}' - Total history length: {len(self._transcript_history)} chars")
        logging.debug(f"[TRANSCRIPT_HISTORY] Current history preview: '{self._transcript_history[-100:]}'...")
        
        # Maintain history window (10x buffer size)
        max_history = self.bufferFlushLength * 10
        if len(self._transcript_history) > max_history:
            self._transcript_history = self._transcript_history[-max_history:]
            logging.debug(f"[TRANSCRIPT_HISTORY] Trimmed to max {max_history} chars")
            
        # Add to buffer
        self._buffer += text
        logging.debug(f"Added '{text}' to buffer. Buffer size: {len(self._buffer)}")
        
    def getBufferTextWhichShouldBeProcessed(self) -> str:
        """Get buffer text if it should be processed, otherwise empty string"""
        if len(self._buffer) >= self.bufferFlushLength:
            return self._buffer
        return ""
        
    def flushCompletelyProcessedText(self, text: str) -> str:
        """Remove processed text from buffer and return remaining contents"""
        if not text:
            logging.debug("No completed text to flush")
            return self._buffer
            
        if not self._buffer:
            logging.warning("flushCompletelyProcessedText called with empty buffer")
            return self._buffer
            
        # Use fuzzy matcher to remove the text
        result, success = self._fuzzy_matcher.remove_matched_text(self._buffer, text)
        
        if success:
            self._buffer = result
            logging.info(f"Successfully flushed completed text, {len(self._buffer)} chars remain in buffer")
        else:
            # TODO: Add more robust error handling here for production
            # For now, crash during development to catch issues
            match = self._fuzzy_matcher.find_best_match(text, self._buffer)
            best_score = match[2] if match else 0
            
            error_msg = (f"Failed to find completed text in buffer. "
                        f"Best similarity was only {best_score:.2%}. This indicates a system issue.\n"
                        f"Completed text: '{text[:100]}...'\n"
                        f"Buffer content: '{self._buffer[:100]}...'")
            logging.error(error_msg)
            raise RuntimeError(error_msg)
            
        return self._buffer
        
    def getBuffer(self) -> str:
        """Get current buffer content (new API)"""
        return self._buffer
        
    def getTranscriptHistory(self, maxLength: Optional[int] = None) -> str:
        """Get transcript history with optional length limit"""
        if maxLength is None:
            return self._transcript_history
        if maxLength == 0:
            return ""
        # Return the last maxLength characters
        return self._transcript_history[-maxLength:] if len(self._transcript_history) > maxLength else self._transcript_history
        
    def clear(self) -> None:
        """Clear all buffers and reset state"""
        self._buffer = ""
        self._transcript_history = ""
        self._is_first_processing = True
        logging.info("Cleared all buffers")
        
    # Compatibility properties and methods
    @property
    def _text_buffer(self) -> str:
        """Compatibility property for tests accessing _text_buffer directly"""
        return self._buffer
        
    @_text_buffer.setter
    def _text_buffer(self, value: str):
        """Compatibility setter for tests"""
        self._buffer = value
        
    def get_buffer(self) -> str:
        """Compatibility method for old API - delegates to getBuffer()"""
        return self.getBuffer()