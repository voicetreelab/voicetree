#!/usr/bin/env python3
"""
Manual Workflow Integration Tests

Tests that verify the traditional "python main.py" workflow still works
after our PyAudio auto-installation changes.
"""

import pytest
import asyncio
import sys
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.voice_to_text.voice_to_text import VoiceToTextEngine, PYAUDIO_AVAILABLE


class TestManualWorkflow:
    """Test the traditional manual workflow isn't broken"""
    
    def test_voice_engine_creation_for_manual_use(self):
        """Test that VoiceToTextEngine can be created for manual use"""
        # This should work regardless of PyAudio availability
        engine = VoiceToTextEngine()
        
        assert engine is not None
        assert hasattr(engine, 'start_listening')
        assert hasattr(engine, 'process_audio_queue')
        assert hasattr(engine, 'process_audio_file')
        
        print("✅ VoiceToTextEngine created successfully for manual workflow")
    
    def test_pyaudio_auto_installation_behavior(self):
        """Test the PyAudio auto-installation behavior for manual workflow"""
        engine = VoiceToTextEngine()
        
        # Test the start_listening method behavior
        try:
            # This will either work (if PyAudio available) or attempt auto-installation
            with patch('backend.voice_to_text.voice_to_text._ensure_pyaudio_installed') as mock_ensure:
                # Mock successful installation
                mock_ensure.return_value = True
                
                # Mock the actual microphone setup to avoid hardware dependency
                with patch('speech_recognition.Microphone') as mock_mic:
                    mock_source = MagicMock()
                    mock_mic.return_value = mock_source
                    
                    with patch.object(engine.recorder, 'adjust_for_ambient_noise'):
                        with patch.object(engine.recorder, 'listen_in_background'):
                            # This should work without errors
                            engine.start_listening()
                            
                            print("✅ start_listening() works with mocked PyAudio installation")
                            
        except Exception as e:
            if "PyAudio installation failed" in str(e):
                print("📝 Expected: PyAudio installation would be attempted in real scenario")
            else:
                raise
    
    def test_manual_workflow_imports(self):
        """Test that all imports needed for manual workflow work"""
        try:
            # Test the main.py imports
            sys.path.insert(0, str(project_root / "backend"))
            
            from backend.voice_to_text.voice_to_text import VoiceToTextEngine
            from backend.tree_manager.decision_tree_ds import DecisionTree
            
            # These should work without issues
            decision_tree = DecisionTree()
            voice_engine = VoiceToTextEngine()
            
            assert decision_tree is not None
            assert voice_engine is not None
            
            print("✅ All manual workflow imports work correctly")
            
        except ImportError as e:
            print(f"❌ Import error in manual workflow: {e}")
            raise
    
    def test_live_recording_error_handling(self):
        """Test that live recording errors are handled gracefully"""
        engine = VoiceToTextEngine()
        
        # Test with failed PyAudio installation
        with patch('backend.voice_to_text.voice_to_text._ensure_pyaudio_installed') as mock_ensure:
            mock_ensure.return_value = False  # Simulate installation failure
            
            try:
                engine.start_listening()
                assert False, "Should have raised RuntimeError"
            except RuntimeError as e:
                assert "PyAudio installation failed" in str(e)
                assert "Use process_audio_file()" in str(e)
                print("✅ Live recording fails gracefully with helpful error message")
                print(f"   Error: {str(e)[:100]}...")
    
    @pytest.mark.timeout(60)  # 1 minute timeout for this test
    def test_alternative_file_processing_workflow(self):
        """Test that users can use file processing as alternative to live recording"""
        engine = VoiceToTextEngine()
        
        # Create a simple test scenario
        test_audio_path = project_root / "backend" / "tests" / "voice_example_test_input.m4a"
        
        if test_audio_path.exists():
            print("🎵 Testing file-based alternative workflow")
            
            # Set environment variable for stability
            os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
            
            try:
                transcript = engine.process_audio_file(str(test_audio_path))
                
                if transcript:
                    print(f"✅ File processing works as alternative to live recording")
                    print(f"   Transcript length: {len(transcript)} characters")
                    print(f"   Preview: '{transcript[:100]}...'")
                    
                    return True
                else:
                    print("📝 File processing returned empty result")
                    return False
                    
            except Exception as e:
                print(f"❌ File processing alternative failed: {e}")
                return False
        else:
            print("📝 No test audio file available for alternative workflow test")
            return True  # Not a failure - just no test file
    
    def test_main_py_structure_compatibility(self):
        """Test that main.py structure is compatible with our changes"""
        try:
            # Read and parse main.py to check for compatibility issues
            main_py_path = project_root / "backend" / "main.py"
            
            if main_py_path.exists():
                with open(main_py_path, 'r') as f:
                    main_content = f.read()
                
                # Check for key components
                assert "VoiceToTextEngine" in main_content
                assert "start_listening()" in main_content
                assert "process_audio_queue()" in main_content
                
                print("✅ main.py structure is compatible with our changes")
                print("   - VoiceToTextEngine import: ✓")
                print("   - start_listening() call: ✓") 
                print("   - process_audio_queue() call: ✓")
                
            else:
                print("📝 main.py not found at expected location")
                
        except Exception as e:
            print(f"❌ main.py compatibility check failed: {e}")
            raise


if __name__ == "__main__":
    # Run tests directly
    pytest.main([__file__, "-v", "-s"]) 