"""
Voice to text configuration
"""

from dataclasses import dataclass


@dataclass
class VoiceConfig:
    """Configuration for voice to text processing"""
    
    model: str = "large-v3"  # Options: "distil-large-v3", "large-v3"
    sample_rate: int = 16000
    channels: int = 1
    chunk_duration: float = 0.5  # seconds
    silence_threshold: float = 0.5  # seconds of silence before processing
    
    def __post_init__(self):
        """Validate configuration"""
        valid_models = ["distil-large-v3", "large-v3"]
        if self.model not in valid_models:
            raise ValueError(f"model must be one of {valid_models}")