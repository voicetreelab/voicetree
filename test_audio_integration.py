#!/usr/bin/env python3
"""
Quick test script to verify .m4a audio processing works
"""
import os
import sys
from pathlib import Path

# Set environment variable for OpenMP
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'

# Add project to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

def test_m4a_processing():
    """Test that we can process the .m4a file"""
    print("🎵 Testing .m4a Audio Processing")
    print("=" * 50)
    
    try:
        from backend.voice_to_text.voice_to_text import VoiceToTextEngine
        
        # Path to test audio file
        audio_path = "backend/tests/voice_example_test_input.m4a"
        
        if not os.path.exists(audio_path):
            print(f"❌ Audio file not found: {audio_path}")
            return False
        
        print(f"📁 Found audio file: {audio_path}")
        
        # Create engine and process
        engine = VoiceToTextEngine()
        print("🔧 Created VoiceToTextEngine")
        
        transcript = engine.process_audio_file(audio_path)
        
        if transcript:
            print(f"✅ Transcription successful!")
            print(f"   Length: {len(transcript)} characters")
            print(f"   Preview: '{transcript[:150]}{'...' if len(transcript) > 150 else ''}'")
            
            # Test chunking
            sentences = [s.strip() + '.' for s in transcript.split('.') if s.strip()]
            print(f"   Chunks: {len(sentences)} sentences for streaming simulation")
            
            return True
        else:
            print("❌ Transcription failed - empty result")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_ci_compatibility():
    """Test that the system works in CI-like environment"""
    print("\n🤖 Testing CI Compatibility")
    print("=" * 50)
    
    try:
        from backend.tests.integration_tests.test_audio_processing import MockVoiceToTextEngine
        
        mock_engine = MockVoiceToTextEngine()
        transcript = mock_engine.process_audio_file()
        
        print(f"✅ Mock audio processing works")
        print(f"   Mock transcript: '{transcript[:100]}...'")
        
        chunks = list(mock_engine.simulate_streaming_chunks())
        print(f"   Mock streaming: {len(chunks)} chunks")
        
        return True
        
    except Exception as e:
        print(f"❌ CI compatibility test failed: {e}")
        return False

if __name__ == "__main__":
    print("🚀 VoiceTree Audio Processing Test Suite")
    print("=" * 60)
    
    success = True
    
    # Test real audio processing
    success &= test_m4a_processing()
    
    # Test CI compatibility  
    success &= test_ci_compatibility()
    
    print("\n" + "=" * 60)
    if success:
        print("🎉 All tests passed! Ready for CI/CD integration")
    else:
        print("❌ Some tests failed - check output above")
        sys.exit(1) 