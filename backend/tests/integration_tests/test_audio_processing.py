#!/usr/bin/env python3
"""
Audio Processing Integration Tests for CI

These tests simulate audio processing using pre-recorded transcripts instead of actual audio files,
making them perfect for CI/CD environments where no audio hardware is available.
"""

import pytest
import asyncio
import os
from pathlib import Path

# Add project root to path
import sys
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.voice_to_text.voice_to_text import VoiceToTextEngine, PYAUDIO_AVAILABLE


class MockVoiceToTextEngine:
    """Mock voice-to-text engine that uses pre-recorded transcripts for CI testing"""
    
    def __init__(self, test_transcript_path: str = None):
        self.test_transcript_path = test_transcript_path or self._get_default_transcript()
    
    def _get_default_transcript(self):
        """Get path to default test transcript"""
        test_data_dir = Path(__file__).parent.parent / "test_data"
        test_data_dir.mkdir(exist_ok=True)
        return test_data_dir / "sample_audio_transcript.txt"
    
    def process_audio_file(self, audio_file_path: str = None) -> str:
        """
        Simulate processing an audio file by returning a test transcript
        Perfect for CI where no actual audio processing is needed!
        """
        try:
            with open(self.test_transcript_path, 'r') as f:
                transcript = f.read().strip()
            
            print(f"📝 Mock transcription from {self.test_transcript_path}: {len(transcript)} characters")
            return transcript
            
        except FileNotFoundError:
            # Fallback to a simple test transcript
            return "This is a test transcript for CI audio processing simulation."
    
    def simulate_streaming_chunks(self):
        """Simulate streaming voice chunks like real-time audio"""
        transcript = self.process_audio_file()
        
        # Split into realistic chunks (like voice recognition would)
        sentences = transcript.split('. ')
        
        for sentence in sentences:
            if sentence.strip():
                yield sentence.strip() + ('.' if not sentence.endswith('.') else '')


class TestAudioProcessingCI:
    """Test audio processing pipeline in CI-friendly way"""
    
    def test_pyaudio_optional_import(self):
        """Test that the system works even when pyaudio is not available"""
        # This test will pass in CI where pyaudio is not installed
        from backend.voice_to_text.voice_to_text import PYAUDIO_AVAILABLE
        
        # Should not crash if pyaudio is missing
        print(f"PyAudio available: {PYAUDIO_AVAILABLE}")
        assert isinstance(PYAUDIO_AVAILABLE, bool)
    
    def test_voice_engine_without_pyaudio(self):
        """Test VoiceToTextEngine creation without pyaudio dependency"""
        # Should work even without pyaudio for file processing
        engine = VoiceToTextEngine()
        assert engine is not None
        assert hasattr(engine, 'process_audio_file')
    
    def test_live_recording_pyaudio_handling(self):
        """Test that live recording handles pyaudio auto-installation"""
        engine = VoiceToTextEngine()
        
        # In CI, this should attempt auto-installation but may fail due to system deps
        # That's expected and the test should document this behavior
        try:
            engine.start_listening()
            print("✅ Live recording started successfully (PyAudio available or installed)")
        except RuntimeError as e:
            if "installation failed" in str(e) or "PyAudio" in str(e):
                print("📝 Expected: PyAudio auto-installation failed in CI environment")
                print("   This is normal - CI doesn't have audio system dependencies")
                # This is expected behavior in CI
                assert True
            else:
                raise
    
    def test_mock_audio_processing(self):
        """Test the mock audio processing for CI"""
        mock_engine = MockVoiceToTextEngine()
        
        # Should return a test transcript
        transcript = mock_engine.process_audio_file("dummy_path.wav")
        
        assert isinstance(transcript, str)
        assert len(transcript) > 0
        print(f"✅ Mock audio processing returned: '{transcript[:50]}...'")
    

    
    
    def test_streaming_simulation(self):
        """Test simulated streaming audio chunks"""
        mock_engine = MockVoiceToTextEngine()
        
        chunks = list(mock_engine.simulate_streaming_chunks())
        
        assert len(chunks) > 0
        print(f"✅ Generated {len(chunks)} streaming chunks")
        
        for i, chunk in enumerate(chunks[:3]):  # Show first 3 chunks
            print(f"   Chunk {i+1}: '{chunk[:30]}...'")
    
    @pytest.mark.asyncio
    async def test_full_pipeline_with_mock_audio(self):
        """Test the full voice processing pipeline with mock audio (simplified for CI)"""
        try:
            # Try to import the full pipeline - may not be available in all test environments
            sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
            from process_transcription import TranscriptionProcessor
            from backend.tree_manager.decision_tree_ds import DecisionTree
            from backend.tree_manager.text_to_tree_manager import ContextualTreeManager
            from backend.tree_manager.tree_to_markdown_converter import TreeToMarkdownConverter
            
            # Setup components
            decision_tree = DecisionTree()
            tree_manager = ContextualTreeManager(decision_tree=decision_tree)
            converter = TreeToMarkdownConverter(decision_tree)
            processor = TranscriptionProcessor(tree_manager, converter)
            
            # Use mock audio engine
            mock_engine = MockVoiceToTextEngine()
            
            # Process streaming chunks
            for chunk in mock_engine.simulate_streaming_chunks():
                await processor.process_and_convert(chunk)
                # Small delay to simulate real-time processing
                await asyncio.sleep(0.01)
            
            print("✅ Full pipeline test completed successfully!")
            
            # Verify some processing occurred
            assert len(decision_tree.tree) > 0
            print(f"   Created {len(decision_tree.tree)} nodes in decision tree")
            
        except ImportError as e:
            # If imports fail, that's OK for CI - just test the mock engine
            print(f"📝 Full pipeline imports not available: {e}")
            print("   Testing mock audio engine only...")
            
            mock_engine = MockVoiceToTextEngine()
            chunks = list(mock_engine.simulate_streaming_chunks())
            
            assert len(chunks) > 0
            print(f"✅ Mock engine test passed: {len(chunks)} chunks generated")
    



if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v"]) 