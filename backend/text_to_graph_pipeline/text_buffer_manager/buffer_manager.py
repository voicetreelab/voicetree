"""
Main Text Buffer Manager implementation
Provides a clean interface for text buffering and chunk processing
"""

import logging
from typing import Optional, Dict, Any
from dataclasses import dataclass

from .buffer_config import BufferConfig
from .sentence_extractor import SentenceExtractor


@dataclass
class BufferResult:
    """Result from buffer processing"""
    text: Optional[str] = None
    is_ready: bool = False
    stats: Dict[str, Any] = None


class TextBufferManager:
    """
    Manages text buffering with adaptive processing strategy.
    
    This class provides a clean interface for:
    - Adding text to buffers
    - Determining when text is ready for processing
    - Managing incomplete chunks
    - Tracking transcript history
    """
    
    def __init__(self, config: Optional[BufferConfig] = None):
        """
        Initialize the buffer manager
        
        Args:
            config: Optional buffer configuration. Uses defaults if not provided.
        """
        self.config = config or BufferConfig()
        self.sentence_extractor = SentenceExtractor()
        
        # Core buffers
        self._text_buffer = ""
        self._transcript_history = ""
        self._incomplete_chunk_remainder = ""
        
        # Processing state
        self._is_first_processing = True
        
        logging.info(
            f"TextBufferManager initialized with threshold={self.config.buffer_size_threshold}"
        )
    
    def add_text(self, text: str) -> BufferResult:
        """
        Add new text to the buffer and check if processing should occur.
        
        Args:
            text: New text to add
            
        Returns:
            BufferResult with text ready for processing (if any) and stats
        """
        if not text:
            return BufferResult(is_ready=False)
        
        # Handle incomplete chunk remainder
        full_text = self._merge_with_remainder(text)
        
        # Update transcript history
        self._transcript_history += text + " "
        self._maintain_history_window()
        
        # Determine processing strategy
        if self._should_process_immediately(full_text):
            return self._create_immediate_result(full_text)
        else:
            return self._process_buffered(full_text)
    
    def set_incomplete_remainder(self, remainder: str) -> None:
        """
        Set text that should be prepended to the next input.
        
        Args:
            remainder: Incomplete text from previous processing
        """
        self._incomplete_chunk_remainder = remainder
        if remainder:
            logging.debug(f"Stored incomplete remainder: '{remainder[:50]}...'")
    
    def get_transcript_history(self) -> str:
        """Get the recent transcript history for context"""
        return self._transcript_history
    
    def is_first_processing(self) -> bool:
        """Check if this is the first processing call"""
        if self._is_first_processing:
            self._is_first_processing = False
            return True
        return False
    
    def clear(self) -> None:
        """Clear all buffers and reset state"""
        self._text_buffer = ""
        self._transcript_history = ""
        self._incomplete_chunk_remainder = ""
        self._is_first_processing = True
        logging.info("Cleared all buffers")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current buffer statistics"""
        return {
            "text_buffer_size": len(self._text_buffer),
            "transcript_history_size": len(self._transcript_history),
            "incomplete_remainder_size": len(self._incomplete_chunk_remainder),
            "buffer_threshold": self.config.buffer_size_threshold,
            "is_first": self._is_first_processing
        }
    
    # Private methods
    
    def _merge_with_remainder(self, text: str) -> str:
        """Merge new text with any incomplete remainder"""
        if self._incomplete_chunk_remainder:
            full_text = self._incomplete_chunk_remainder + " " + text
            self._incomplete_chunk_remainder = ""
            logging.debug(f"Merged with remainder: '{full_text[:50]}...'")
            return full_text
        return text
    
    def _maintain_history_window(self) -> None:
        """Keep transcript history within configured bounds"""
        max_history = self.config.buffer_size_threshold * self.config.transcript_history_multiplier
        if len(self._transcript_history) > max_history:
            self._transcript_history = self._transcript_history[-max_history:]
    
    def _should_process_immediately(self, text: str) -> bool:
        """Determine if text should be processed immediately"""
        text_size = len(text.strip())
        
        # Large text
        threshold = self.config.buffer_size_threshold * self.config.immediate_processing_size_multiplier
        if text_size > threshold:
            logging.debug(f"Immediate processing: large text ({text_size} chars)")
            return True
        
        # Multiple sentences
        sentence_count = self._count_sentences(text)
        if sentence_count >= self.config.min_sentences_for_immediate:
            logging.debug(f"Immediate processing: {sentence_count} sentences")
            return True
        
        # Substantial complete content
        complete_sentences = self.sentence_extractor.extract_complete_sentences(text)
        threshold = self.config.buffer_size_threshold * self.config.substantial_content_threshold
        if complete_sentences and len(complete_sentences) > threshold:
            logging.debug(f"Immediate processing: substantial content ({len(complete_sentences)} chars)")
            return True
        
        return False
    
    def _create_immediate_result(self, text: str) -> BufferResult:
        """Create result for immediate processing"""
        return BufferResult(
            text=text.strip(),
            is_ready=True,
            stats=self.get_stats()
        )
    
    def _process_buffered(self, text: str) -> BufferResult:
        """Process text using buffering strategy"""
        # Add to buffer
        self._text_buffer += text + " "
        
        # Extract complete sentences
        complete_sentences = self.sentence_extractor.extract_complete_sentences(self._text_buffer)
        
        # Check if ready to process
        should_process = (
            len(complete_sentences) > self.config.buffer_size_threshold or
            (len(self._text_buffer) > self.config.buffer_size_threshold and not complete_sentences)
        )
        
        if should_process:
            # Use complete sentences if available, otherwise entire buffer
            text_to_process = complete_sentences or self._text_buffer.strip()
            
            # Update buffer
            if complete_sentences:
                self._text_buffer = self._text_buffer[len(complete_sentences):].strip()
            else:
                self._text_buffer = ""
            
            logging.info(f"Buffer ready: '{text_to_process[:50]}...'")
            return BufferResult(
                text=text_to_process,
                is_ready=True,
                stats=self.get_stats()
            )
        
        return BufferResult(is_ready=False, stats=self.get_stats())
    
    def _count_sentences(self, text: str) -> int:
        """Count sentence endings in text"""
        return text.count('.') + text.count('!') + text.count('?')