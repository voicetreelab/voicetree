"""
Unified Buffer Manager for VoiceTree
Consolidates all text buffering and chunk handling logic with adaptive processing
"""

import logging
import threading
from typing import Optional, Tuple, List
import re

from backend.tree_manager.utils import extract_complete_sentences


class UnifiedBufferManager:
    """
    Unified buffer manager that adaptively handles text buffering and chunk processing.
    Automatically determines processing strategy based on input characteristics.
    """
    
    # Constants for safety and reliability
    MAX_BUFFER_SIZE = 500  # Prevent unbounded memory growth
    ABBREV_PATTERN = re.compile(r'\b(?:Dr|Mr|Ms|Mrs|Prof|Inc|Ltd|etc|vs|i\.e|e\.g)\.$', re.IGNORECASE)
    
    def __init__(self, buffer_size_threshold: int = 500):
        """
        Initialize the buffer manager
        
        Args:
            buffer_size_threshold: Size threshold for processing chunks
        """
        self.buffer_size_threshold = buffer_size_threshold
        
        # Core buffers
        self._text_buffer = ""
        self._transcript_history = ""
        self._incomplete_chunk_remainder = ""
        
        # Processing state
        self._is_first_processing = True
        
        # Thread safety
        self._lock = threading.Lock()
        
        logging.info(f"UnifiedBufferManager initialized with adaptive processing")
    
    def add_text(self, text: str) -> Optional[str]:
        """
        Add new text to the buffer and return text ready for processing if available.
        Adaptively determines processing strategy based on input characteristics.
        
        Args:
            text: New text to add to buffer
            
        Returns:
            Text ready for processing, or None if not ready yet
        """
        with self._lock:
            # Input validation
            if not text:
                return None
            
            # Handle incomplete chunk remainder from previous processing
            full_text = text
            self._had_incomplete_remainder = False
            if self._incomplete_chunk_remainder:
                full_text = self._incomplete_chunk_remainder + " " + text
                self._had_incomplete_remainder = True
                # Clear the remainder now that we've used it
                self._incomplete_chunk_remainder = ""
                logging.info(f"Prepended incomplete chunk: '{full_text[:50]}...'")
            
            # Check for buffer overflow before processing
            if len(self._text_buffer) + len(full_text) > self.MAX_BUFFER_SIZE:
                logging.warning(f"Buffer approaching max size, forcing processing")
                return self._force_process_buffer()
            
            # Adaptive processing decision based on input characteristics
            if self._should_process_immediately(full_text):
                # Process immediately (like discrete mode)
                # Also update transcript history when processing immediately
                self._transcript_history += full_text + " "
                return full_text.strip()
            else:
                # Use buffering strategy (like streaming mode)
                return self._process_with_buffering(full_text)
    
    def _should_process_immediately(self, text: str) -> bool:
        """
        Determine if text should be processed immediately based on multiple criteria.
        Considers both size and sentence completeness.
        
        Args:
            text: Text to evaluate
            
        Returns:
            True if should process immediately, False if should buffer
        """
        text_size = len(text.strip())
        
        # Process immediately if text exceeds threshold
        if text_size >= self.buffer_size_threshold:
            logging.debug(f"Processing immediately: text size ({text_size}) >= threshold ({self.buffer_size_threshold})")
            return True
        
        # Also process immediately if we have multiple complete sentences
        # This handles cases like "First sentence. Second sentence! Third sentence?"
        sentence_endings = re.findall(r'[.!?]+', text)
        # Filter out abbreviations to avoid false positives
        non_abbrev_endings = []
        for match in re.finditer(r'[.!?]+', text):
            end_pos = match.start()
            # Get text before the punctuation to check for abbreviations
            text_before = text[:end_pos].strip()
            if not self.ABBREV_PATTERN.search(text_before):
                non_abbrev_endings.append(match.group())
        
        if len(non_abbrev_endings) >= 2:
            logging.debug(f"Processing immediately: found {len(non_abbrev_endings)} complete sentences")
            return True
        
        # If we had an incomplete remainder, process it now that we have more text
        if hasattr(self, '_had_incomplete_remainder') and self._had_incomplete_remainder:
            logging.debug("Processing immediately: combining with incomplete remainder")
            return True
        
        # Otherwise, buffer for more content
        logging.debug(f"Buffering text: size ({text_size}) < threshold ({self.buffer_size_threshold}), {len(non_abbrev_endings)} sentences")
        return False
    
    def _process_with_buffering(self, text: str) -> Optional[str]:
        """
        Simple buffering strategy based on character count only.
        Avoids sentence extraction due to voice-to-text punctuation issues.
        
        Args:
            text: Text to add to buffer
            
        Returns:
            Text ready for processing, or None if not ready
        """
        # Add to buffer
        self._text_buffer += text + " "
        self._transcript_history += text + " "
        
        # Check for buffer overflow after adding text
        if len(self._text_buffer) > self.MAX_BUFFER_SIZE:
            logging.warning(f"Buffer exceeded max size ({len(self._text_buffer)} > {self.MAX_BUFFER_SIZE}), forcing processing")
            text_to_process = self._text_buffer.strip()
            self._text_buffer = ""  # Clear buffer after processing
            return text_to_process
        
        # Maintain transcript history window
        max_history = self.buffer_size_threshold * 3
        if len(self._transcript_history) > max_history:
            self._transcript_history = self._transcript_history[-max_history:]
        
        # Simple check: process when buffer reaches threshold
        if len(self._text_buffer) >= self.buffer_size_threshold:
            text_to_process = self._text_buffer.strip()
            self._text_buffer = ""  # Clear buffer after processing
            
            logging.info(f"Buffer ready for processing: '{text_to_process[:50]}...' ({len(text_to_process)} chars)")
            return text_to_process
        
        logging.debug(f"Buffer accumulating: {len(self._text_buffer)}/{self.buffer_size_threshold} chars")
        return None
    
    def _force_process_buffer(self) -> Optional[str]:
        """Force process buffer contents when approaching size limits"""
        if self._text_buffer:
            # Process whatever we have in the buffer
            text_to_process = self._text_buffer.strip()
            self._text_buffer = ""
            logging.warning(f"Force processing {len(text_to_process)} chars due to buffer size")
            return text_to_process
        return None
    
    def set_incomplete_remainder(self, remainder: str) -> None:
        """
        Set incomplete chunk remainder from workflow processing
        
        Args:
            remainder: Incomplete text to carry forward
        """
        with self._lock:
            self._incomplete_chunk_remainder = remainder
            if remainder:
                logging.info(f"Stored incomplete chunk remainder: '{remainder[:50]}...'")
    
    def get_incomplete_remainder(self) -> str:
        """Get the current incomplete chunk remainder"""
        with self._lock:
            return self._incomplete_chunk_remainder
    
    def get_transcript_history(self) -> str:
        """Get the transcript history for context"""
        with self._lock:
            return self._transcript_history
    
    def clear_buffers(self) -> None:
        """Clear all buffers"""
        with self._lock:
            self._text_buffer = ""
            self._transcript_history = ""
            self._incomplete_chunk_remainder = ""
            self._is_first_processing = True
            logging.info("Cleared all buffers")
    
    def is_first_processing(self) -> bool:
        """Check if this is the first processing call"""
        with self._lock:
            if self._is_first_processing:
                self._is_first_processing = False
                return True
            return False
    
    def get_buffer_stats(self) -> dict:
        """Get current buffer statistics"""
        with self._lock:
            return {
                "processing_strategy": "adaptive",
                "text_buffer_size": len(self._text_buffer),
                "transcript_history_size": len(self._transcript_history),
                "incomplete_remainder_size": len(self._incomplete_chunk_remainder),
                "buffer_threshold": self.buffer_size_threshold,
                "max_buffer_size": self.MAX_BUFFER_SIZE
            } 