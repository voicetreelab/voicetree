"""
Unified Buffer Manager for VoiceTree
Consolidates all text buffering and chunk handling logic with adaptive processing
"""

import logging
from typing import Optional, Tuple, List
import re

from backend.text_to_graph_pipeline.tree_manager.utils import extract_complete_sentences


class UnifiedBufferManager:
    """
    Unified buffer manager that adaptively handles text buffering and chunk processing.
    Automatically determines processing strategy based on input characteristics.
    """
    
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
        # Handle incomplete chunk remainder from previous processing
        full_text = text
        if self._incomplete_chunk_remainder:
            full_text = self._incomplete_chunk_remainder + " " + text
            self._incomplete_chunk_remainder = ""
            logging.info(f"Prepended incomplete chunk: '{full_text[:50]}...'")
        
        # Adaptive processing decision based on input characteristics
        if self._should_process_immediately(full_text):
            # Process immediately (like discrete mode)
            return full_text.strip()
        else:
            # Use buffering strategy (like streaming mode)
            return self._process_with_buffering(full_text)
    
    def _should_process_immediately(self, text: str) -> bool:
        """
        Determine if text should be processed immediately based on characteristics
        
        Args:
            text: Text to evaluate
            
        Returns:
            True if should process immediately, False if should buffer
        """
        # Process immediately if:
        # 1. Text is already quite large (likely a complete chunk)
        # 2. Text contains multiple complete sentences (likely a complete thought)
        # 3. Text has substantial complete sentences with good content
        
        text_size = len(text.strip())
        
        # Large text suggests it's already a complete chunk - be more generous
        if text_size > self.buffer_size_threshold * 1.5:  # 1.5x threshold for immediate processing
            logging.debug(f"Processing immediately: large text ({text_size} chars)")
            return True
        
        # Multiple sentences suggest complete thoughts - require more sentences
        sentence_endings = text.count('.') + text.count('!') + text.count('?')
        if sentence_endings >= 3:  # Increased from 2 to 3 for better coherence
            logging.debug(f"Processing immediately: multiple sentences ({sentence_endings})")
            return True
        
        # Check if we have substantial complete sentences - be more selective
        complete_sentences = extract_complete_sentences(text)
        if complete_sentences and len(complete_sentences) > self.buffer_size_threshold * 0.8:  # 80% of threshold
            logging.debug(f"Processing immediately: substantial complete content ({len(complete_sentences)} chars)")
            return True
        
        # Otherwise, use buffering strategy for better coherence
        logging.debug(f"Using buffering strategy for text: '{text[:30]}...'")
        return False
    
    def _process_with_buffering(self, text: str) -> Optional[str]:
        """
        Process text using buffering strategy (accumulate until ready)
        
        Args:
            text: Text to add to buffer
            
        Returns:
            Text ready for processing, or None if not ready
        """
        # Add to buffer
        self._text_buffer += text + " "
        self._transcript_history += text + " "
        
        # Extract complete sentences
        text_to_process = extract_complete_sentences(self._text_buffer)
        
        # Maintain transcript history window
        max_history = self.buffer_size_threshold * 3
        if len(self._transcript_history) > max_history:
            self._transcript_history = self._transcript_history[-max_history:]
        
        # Check if we should process
        should_process = (
            len(text_to_process) > self.buffer_size_threshold or
            (len(self._text_buffer) > self.buffer_size_threshold and len(text_to_process) == 0)
        )
        
        if should_process:
            # If no complete sentences but buffer is large, process buffer as-is
            if len(text_to_process) == 0:
                text_to_process = self._text_buffer.strip()
            
            # Clear processed text from buffer
            self._text_buffer = self._text_buffer[len(text_to_process):].strip()
            
            logging.info(f"Buffer ready for processing: '{text_to_process[:50]}...'")
            return text_to_process
        
        return None
    
    def set_incomplete_remainder(self, remainder: str) -> None:
        """
        Set incomplete chunk remainder from workflow processing
        
        Args:
            remainder: Incomplete text to carry forward
        """
        self._incomplete_chunk_remainder = remainder
        if remainder:
            logging.info(f"Stored incomplete chunk remainder: '{remainder[:50]}...'")
    
    def get_incomplete_remainder(self) -> str:
        """Get the current incomplete chunk remainder"""
        return self._incomplete_chunk_remainder
    
    def get_transcript_history(self) -> str:
        """Get the transcript history for context"""
        return self._transcript_history
    
    def clear_buffers(self) -> None:
        """Clear all buffers"""
        self._text_buffer = ""
        self._transcript_history = ""
        self._incomplete_chunk_remainder = ""
        self._is_first_processing = True
        logging.info("Cleared all buffers")
    
    def is_first_processing(self) -> bool:
        """Check if this is the first processing call"""
        if self._is_first_processing:
            self._is_first_processing = False
            return True
        return False
    
    def get_buffer_stats(self) -> dict:
        """Get current buffer statistics"""
        return {
            "processing_strategy": "adaptive",
            "text_buffer_size": len(self._text_buffer),
            "transcript_history_size": len(self._transcript_history),
            "incomplete_remainder_size": len(self._incomplete_chunk_remainder),
            "buffer_threshold": self.buffer_size_threshold
        } 