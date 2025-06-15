"""
Unified Buffer Manager for VoiceTree
Consolidates buffer management from multiple existing implementations
"""

import logging
import time
from typing import Dict, Any, Optional
from dataclasses import dataclass
from backend.core.config import BufferConfig


@dataclass
class BufferResult:
    """Result from buffer operations"""
    ready_for_processing: bool
    text_to_process: str = ""
    current_size: int = 0
    threshold: int = 500
    overflow: bool = False


class BufferManager:
    """
    Unified buffer manager that handles text buffering and context management
    Replaces UnifiedBufferManager and other buffer implementations
    """
    
    def __init__(self, config: BufferConfig):
        """
        Initialize the buffer manager
        
        Args:
            config: Buffer configuration
        """
        self.config = config
        
        # Buffer state
        self.text_buffer = ""
        self.transcript_history = ""
        self.incomplete_remainder = ""
        
        # Processing state
        self.first_processing = True
        self.append_count = 0
        
        # Statistics
        self.statistics = {
            "total_text_added": 0,
            "total_characters_processed": 0,
            "buffer_flushes": 0,
            "overflow_events": 0,
            "average_buffer_size": 0.0
        }
        
        logging.info(f"BufferManager initialized with threshold {config.text_buffer_size_threshold}")
    
    def add_text(self, text: str) -> BufferResult:
        """
        Add text to the buffer and determine if ready for processing
        
        Args:
            text: New text to add to buffer
            
        Returns:
            BufferResult indicating processing readiness and status
        """
        # Update statistics
        self.statistics["total_text_added"] += len(text)
        
        # Handle incomplete remainder from previous processing
        if self.incomplete_remainder:
            text = self.incomplete_remainder + " " + text
            self.incomplete_remainder = ""
        
        # Add to buffer
        self.text_buffer += text + " "
        current_size = len(self.text_buffer)
        
        # Check if ready for processing
        if current_size >= self.config.text_buffer_size_threshold:
            # Buffer is ready
            text_to_process = self.text_buffer.strip()
            
            # Update transcript history
            self._update_transcript_history(text_to_process)
            
            # Clear buffer
            self.text_buffer = ""
            
            # Update statistics
            self.statistics["buffer_flushes"] += 1
            self.statistics["total_characters_processed"] += len(text_to_process)
            self._update_average_buffer_size(current_size)
            
            return BufferResult(
                ready_for_processing=True,
                text_to_process=text_to_process,
                current_size=0,  # Buffer is now empty
                threshold=self.config.text_buffer_size_threshold
            )
        else:
            # Still buffering
            return BufferResult(
                ready_for_processing=False,
                current_size=current_size,
                threshold=self.config.text_buffer_size_threshold
            )
    
    def force_process_buffer(self) -> BufferResult:
        """
        Force process whatever is in the buffer, regardless of threshold
        
        Returns:
            BufferResult with current buffer content
        """
        if not self.text_buffer.strip():
            return BufferResult(
                ready_for_processing=False,
                current_size=0,
                threshold=self.config.text_buffer_size_threshold
            )
        
        text_to_process = self.text_buffer.strip()
        current_size = len(text_to_process)
        
        # Update transcript history
        self._update_transcript_history(text_to_process)
        
        # Clear buffer
        self.text_buffer = ""
        
        # Update statistics
        self.statistics["buffer_flushes"] += 1
        self.statistics["total_characters_processed"] += len(text_to_process)
        self._update_average_buffer_size(current_size)
        
        return BufferResult(
            ready_for_processing=True,
            text_to_process=text_to_process,
            current_size=0,
            threshold=self.config.text_buffer_size_threshold
        )
    
    def set_incomplete_remainder(self, remainder: str) -> None:
        """
        Set text that couldn't be completely processed
        
        Args:
            remainder: Text to carry over to next processing cycle
        """
        self.incomplete_remainder = remainder
        logging.debug(f"Set incomplete remainder: {len(remainder)} characters")
    
    def get_context(self) -> Dict[str, Any]:
        """
        Get context information for processing
        
        Returns:
            Dictionary with context information
        """
        return {
            "transcript_history": self._get_relevant_transcript_history(),
            "is_first_processing": self.first_processing,
            "append_count": self.append_count,
            "buffer_size": len(self.text_buffer),
            "has_incomplete_remainder": bool(self.incomplete_remainder)
        }
    
    def is_first_processing(self) -> bool:
        """Check if this is the first processing cycle"""
        result = self.first_processing
        if self.first_processing:
            self.first_processing = False
        return result
    
    def increment_append_count(self) -> int:
        """Increment and return the append count"""
        self.append_count += 1
        return self.append_count
    
    def should_trigger_background_rewrite(self) -> bool:
        """Check if background rewrite should be triggered"""
        return (self.append_count > 0 and 
                self.append_count % self.config.background_rewrite_every_n_append == 0)
    
    def clear_buffers(self) -> None:
        """Clear all buffers and reset state"""
        self.text_buffer = ""
        self.transcript_history = ""
        self.incomplete_remainder = ""
        self.first_processing = True
        self.append_count = 0
        
        logging.info("All buffers cleared")
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get buffer management statistics"""
        return {
            **self.statistics,
            "current_buffer_size": len(self.text_buffer),
            "current_history_size": len(self.transcript_history),
            "has_incomplete_remainder": bool(self.incomplete_remainder),
            "append_count": self.append_count,
            "threshold": self.config.text_buffer_size_threshold
        }
    
    def reset_statistics(self) -> None:
        """Reset buffer statistics"""
        self.statistics = {
            "total_text_added": 0,
            "total_characters_processed": 0,
            "buffer_flushes": 0,
            "overflow_events": 0,
            "average_buffer_size": 0.0
        }
    
    def _update_transcript_history(self, processed_text: str) -> None:
        """
        Update the transcript history with processed text
        
        Args:
            processed_text: Text that was just processed
        """
        # Add to history
        self.transcript_history += processed_text + " "
        
        # Trim history if it gets too long
        max_history_length = (
            self.config.text_buffer_size_threshold * 
            self.config.transcript_history_multiplier
        )
        
        if len(self.transcript_history) > max_history_length:
            # Keep the most recent part
            excess = len(self.transcript_history) - max_history_length
            self.transcript_history = self.transcript_history[excess:]
            logging.debug(f"Trimmed transcript history by {excess} characters")
    
    def _get_relevant_transcript_history(self) -> str:
        """
        Get relevant transcript history for context
        
        Returns:
            Relevant portion of transcript history
        """
        if not self.transcript_history:
            return ""
        
        # Return the most recent part of history
        max_context_length = self.config.text_buffer_size_threshold * 2
        
        if len(self.transcript_history) <= max_context_length:
            return self.transcript_history
        else:
            # Return the tail
            return "..." + self.transcript_history[-max_context_length:]
    
    def _update_average_buffer_size(self, current_size: int) -> None:
        """
        Update the running average buffer size
        
        Args:
            current_size: Current buffer size
        """
        if self.statistics["buffer_flushes"] == 1:
            self.statistics["average_buffer_size"] = current_size
        else:
            # Running average
            current_avg = self.statistics["average_buffer_size"]
            flushes = self.statistics["buffer_flushes"]
            self.statistics["average_buffer_size"] = (
                (current_avg * (flushes - 1) + current_size) / flushes
            ) 