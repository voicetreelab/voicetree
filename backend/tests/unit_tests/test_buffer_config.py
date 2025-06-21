"""
Unit tests for buffer configuration
"""

import pytest
from backend.text_to_graph_pipeline.text_buffer_manager.buffer_config import BufferConfig


class TestBufferConfig:
    """Test suite for BufferConfig class"""
    
    def test_default_values(self):
        """Test default configuration values"""
        config = BufferConfig()
        assert config.buffer_size_threshold == 83
        assert config.transcript_history_multiplier == 3
        assert config.immediate_processing_size_multiplier == 1.5
        assert config.substantial_content_threshold == 0.8
        assert config.min_sentences_for_immediate == 3
    
    def test_custom_values(self):
        """Test custom configuration values"""
        config = BufferConfig(
            buffer_size_threshold=100,
            transcript_history_multiplier=5,
            immediate_processing_size_multiplier=2.0,
            substantial_content_threshold=0.9,
            min_sentences_for_immediate=5
        )
        assert config.buffer_size_threshold == 100
        assert config.transcript_history_multiplier == 5
        assert config.immediate_processing_size_multiplier == 2.0
        assert config.substantial_content_threshold == 0.9
        assert config.min_sentences_for_immediate == 5
    
    def test_buffer_size_threshold_validation(self):
        """Test buffer_size_threshold validation"""
        with pytest.raises(ValueError, match="buffer_size_threshold must be positive"):
            BufferConfig(buffer_size_threshold=0)
        
        with pytest.raises(ValueError, match="buffer_size_threshold must be positive"):
            BufferConfig(buffer_size_threshold=-1)
    
    def test_transcript_history_multiplier_validation(self):
        """Test transcript_history_multiplier validation"""
        with pytest.raises(ValueError, match="transcript_history_multiplier must be positive"):
            BufferConfig(transcript_history_multiplier=0)
        
        with pytest.raises(ValueError, match="transcript_history_multiplier must be positive"):
            BufferConfig(transcript_history_multiplier=-1)
    
    def test_immediate_processing_size_multiplier_validation(self):
        """Test immediate_processing_size_multiplier validation"""
        with pytest.raises(ValueError, match="immediate_processing_size_multiplier must be between 0 and 3"):
            BufferConfig(immediate_processing_size_multiplier=0)
        
        with pytest.raises(ValueError, match="immediate_processing_size_multiplier must be between 0 and 3"):
            BufferConfig(immediate_processing_size_multiplier=3.1)
        
        with pytest.raises(ValueError, match="immediate_processing_size_multiplier must be between 0 and 3"):
            BufferConfig(immediate_processing_size_multiplier=-0.1)
    
    def test_substantial_content_threshold_validation(self):
        """Test substantial_content_threshold validation"""
        with pytest.raises(ValueError, match="substantial_content_threshold must be between 0 and 1"):
            BufferConfig(substantial_content_threshold=0)
        
        with pytest.raises(ValueError, match="substantial_content_threshold must be between 0 and 1"):
            BufferConfig(substantial_content_threshold=1.1)
        
        with pytest.raises(ValueError, match="substantial_content_threshold must be between 0 and 1"):
            BufferConfig(substantial_content_threshold=-0.1)
    
    def test_min_sentences_for_immediate_validation(self):
        """Test min_sentences_for_immediate validation"""
        with pytest.raises(ValueError, match="min_sentences_for_immediate must be at least 1"):
            BufferConfig(min_sentences_for_immediate=0)
        
        with pytest.raises(ValueError, match="min_sentences_for_immediate must be at least 1"):
            BufferConfig(min_sentences_for_immediate=-1)
    
    def test_edge_case_valid_values(self):
        """Test edge case valid values"""
        # Test minimum valid values
        config = BufferConfig(
            buffer_size_threshold=1,
            transcript_history_multiplier=1,
            immediate_processing_size_multiplier=0.1,
            substantial_content_threshold=0.1,
            min_sentences_for_immediate=1
        )
        assert config.buffer_size_threshold == 1
        assert config.transcript_history_multiplier == 1
        assert config.immediate_processing_size_multiplier == 0.1
        assert config.substantial_content_threshold == 0.1
        assert config.min_sentences_for_immediate == 1
        
        # Test maximum valid values
        config = BufferConfig(
            immediate_processing_size_multiplier=3.0,
            substantial_content_threshold=1.0
        )
        assert config.immediate_processing_size_multiplier == 3.0
        assert config.substantial_content_threshold == 1.0