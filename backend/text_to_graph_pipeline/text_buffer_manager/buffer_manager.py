"""
Main Text Buffer Manager implementation
Provides a clean interface for text buffering and chunk processing
"""

import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass

from .buffer_config import BufferConfig
from .fuzzy_text_matcher import FuzzyTextMatcher


@dataclass
class BufferResult:
    """Result from buffer processing"""
    text: Optional[str] = None
    is_ready: bool = False
    stats: Dict[str, Any] = None


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
    
    def __init__(self, config: Optional[BufferConfig] = None):
        """
        Initialize the buffer manager.
        
        Args:
            config: Optional BufferConfig object
        """
        self.config = config or BufferConfig()
        self._buffer = ""
        self._transcript_history = ""
        self._is_first_processing = True
        self._fuzzy_matcher = FuzzyTextMatcher(similarity_threshold=0.8)
        logging.info(f"TextBufferManager initialized with threshold: {self.config.buffer_size_threshold}")
        
    def add_text(self, text: str) -> BufferResult:
        """
        Add text to the buffer and process if threshold is reached.
        
        Args:
            text: Text to add to the buffer
            
        Returns:
            BufferResult with is_ready flag and text to process
        """
        # Skip empty or whitespace-only text
        if not text or not text.strip():
            logging.debug("Skipping empty/whitespace text")
            return BufferResult(is_ready=False, text="")
            
        # Add to transcript history immediately
        self._transcript_history += text + " "
        logging.debug(f"[TRANSCRIPT_HISTORY] Added '{text}' - Total history length: {len(self._transcript_history)} chars")
        logging.debug(f"[TRANSCRIPT_HISTORY] Current history preview: '{self._transcript_history[-100:]}'...")
        
        # Maintain history window
        max_history = self.config.buffer_size_threshold * self.config.transcript_history_multiplier
        if len(self._transcript_history) > max_history:
            self._transcript_history = self._transcript_history[-max_history:]
            logging.debug(f"[TRANSCRIPT_HISTORY] Trimmed to max {max_history} chars")
            
        # Add to buffer
        self._buffer += text
        logging.debug(f"Added '{text}' to buffer. Buffer size: {len(self._buffer)}")
        
        # Check if we should process
        if len(self._buffer) >= self.config.buffer_size_threshold:
            return self._process_buffer()
            
        return BufferResult(is_ready=False, text="")
        
    def _process_buffer(self) -> BufferResult:
        """Process the current buffer content without clearing it"""
        text_to_process = self._buffer
        # DO NOT clear buffer here - it will be updated by flush_completed_text
        
        logging.info(f"Processing buffer: {len(text_to_process)} chars")
        return BufferResult(is_ready=True, text=text_to_process)
        
    def get_buffer(self) -> str:
        """Get current buffer content without modifying it"""
        return self._buffer
        
    def get_transcript_history(self) -> str:
        """Get the complete transcript history"""
        return self._transcript_history
        
    def is_first_processing(self) -> bool:
        """Check if this is the first time processing"""
        if self._is_first_processing:
            self._is_first_processing = False
            return True
        return False
        
        
    def clear(self) -> None:
        """Clear all buffers and reset state"""
        self._buffer = ""
        self._transcript_history = ""
        self._is_first_processing = True
        logging.info("Cleared all buffers")
        
    def get_stats(self) -> Dict[str, Any]:
        """Get current buffer statistics"""
        return {
            "text_buffer_size": len(self._buffer),
            "transcript_history_size": len(self._transcript_history),
            "buffer_threshold": self.config.buffer_size_threshold,
            "is_first": self._is_first_processing,
            "incomplete_chunk_size": 0  # Deprecated - buffer maintains incomplete text internally
        }
        
        
    def flush_completed_text(self, completed_text: str) -> None:
        """
        Remove completed text from buffer using fuzzy matching.
        
        This method uses fuzzy matching to find and remove text that was
        successfully processed by the workflow, handling minor LLM modifications.
        
        Args:
            completed_text: The text that was successfully processed by the workflow
        """
        if not completed_text:
            logging.debug("No completed text to flush")
            return
            
        if not self._buffer:
            logging.warning("flush_completed_text called with empty buffer")
            return
            
        # Use fuzzy matcher to remove the text
        result, success = self._fuzzy_matcher.remove_matched_text(self._buffer, completed_text)
        
        if success:
            self._buffer = result
            logging.info(f"Successfully flushed completed text, {len(self._buffer)} chars remain in buffer")
        else:
            # TODO: Add more robust error handling here for production
            # For now, crash during development to catch issues
            match = self._fuzzy_matcher.find_best_match(completed_text, self._buffer)
            best_score = match[2] if match else 0
            
            error_msg = (f"Failed to find completed text in buffer. "
                        f"Best similarity was only {best_score:.2%}. This indicates a system issue.\n"
                        f"Completed text: '{completed_text[:100]}...'\n"
                        f"Buffer content: '{self._buffer[:100]}...'")
            logging.error(error_msg)
            raise RuntimeError(error_msg)
    
        
    # Compatibility properties and methods
    @property
    def _text_buffer(self) -> str:
        """Compatibility property for tests accessing _text_buffer directly"""
        return self._buffer
        
    @_text_buffer.setter
    def _text_buffer(self, value: str):
        """Compatibility setter for tests"""
        self._buffer = value
