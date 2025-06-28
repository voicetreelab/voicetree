"""
Main Text Buffer Manager implementation
Provides a clean interface for text buffering and chunk processing
"""

import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass

from .buffer_config import BufferConfig


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
        self._incomplete_chunk_text = ""  # Store incomplete chunk text separately
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
        """Process the current buffer content"""
        text_to_process = self._buffer
        self._buffer = ""
        
        # Don't mark as processed in is_first_processing - let that method handle it
        
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
        self._incomplete_chunk_text = ""
        logging.info("Cleared all buffers")
        
    def get_stats(self) -> Dict[str, Any]:
        """Get current buffer statistics"""
        return {
            "text_buffer_size": len(self._buffer),
            "transcript_history_size": len(self._transcript_history),
            "buffer_threshold": self.config.buffer_size_threshold,
            "is_first": self._is_first_processing,
            "incomplete_chunk_size": len(self._incomplete_chunk_text)
        }
        
    def set_incomplete_chunk(self, text: str) -> None:
        """
        Set incomplete chunk text to be prepended to next processing.
        
        This method provides a clean API for managing incomplete chunks without
        causing duplication. The incomplete text is stored separately and will
        be intelligently merged with new content.
        
        Args:
            text: The incomplete chunk text from previous processing
        """
        self._incomplete_chunk_text = text
        if text:
            logging.info(f"Stored incomplete chunk: {len(text)} chars")
            
    def get_incomplete_chunk(self) -> str:
        """Get the current incomplete chunk text"""
        return self._incomplete_chunk_text
        
    def add_text_with_incomplete(self, text: str) -> BufferResult:
        """
        Add text to buffer, properly handling any incomplete chunk from previous processing.
        
        This method ensures that incomplete chunks are merged correctly without duplication.
        The incomplete chunk is only prepended once and then cleared.
        
        Args:
            text: New text to add
            
        Returns:
            BufferResult with processed text that includes properly merged incomplete chunk
        """
        # Merge incomplete chunk if present
        if self._incomplete_chunk_text:
            # Only add the incomplete chunk to the new text, not to history
            # This prevents duplication in the transcript history
            merged_text = self._incomplete_chunk_text + " " + text
            logging.info(f"Merging incomplete chunk ({len(self._incomplete_chunk_text)} chars) with new text")
            self._incomplete_chunk_text = ""  # Clear after use
        else:
            merged_text = text
            
        # Process the merged text normally
        return self.add_text(merged_text)
        
    # Compatibility properties and methods
    @property
    def _text_buffer(self) -> str:
        """Compatibility property for tests accessing _text_buffer directly"""
        return self._buffer
        
    @_text_buffer.setter
    def _text_buffer(self, value: str):
        """Compatibility setter for tests"""
        self._buffer = value
