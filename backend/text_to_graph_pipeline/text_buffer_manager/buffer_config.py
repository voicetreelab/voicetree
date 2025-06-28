"""
Buffer configuration settings
"""

from dataclasses import dataclass


@dataclass
class BufferConfig:
    """Configuration for text buffer management"""
    
    buffer_size_threshold: int = 163
    transcript_history_multiplier: int = 3
    immediate_processing_size_multiplier: float = 1.5
    substantial_content_threshold: float = 0.8
    min_sentences_for_immediate: int = 3
    
    def __post_init__(self):
        """Validate configuration"""
        if self.buffer_size_threshold <= 0:
            raise ValueError("buffer_size_threshold must be positive")
        if self.transcript_history_multiplier <= 0:
            raise ValueError("transcript_history_multiplier must be positive")
        if not 0 < self.immediate_processing_size_multiplier <= 3:
            raise ValueError("immediate_processing_size_multiplier must be between 0 and 3")
        if not 0 < self.substantial_content_threshold <= 1:
            raise ValueError("substantial_content_threshold must be between 0 and 1")
        if self.min_sentences_for_immediate < 1:
            raise ValueError("min_sentences_for_immediate must be at least 1")