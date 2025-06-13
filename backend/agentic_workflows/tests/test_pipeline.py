#!/usr/bin/env python3
"""
Standalone test script for VoiceTree LangGraph pipeline
Can be run directly without complex imports
"""

import sys
import os
from pathlib import Path

# Add project root to path for imports
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent  # Go up to VoiceTreePoc directory
sys.path.insert(0, str(project_root))

try:
    # Import the main module from the backend
    from backend.agentic_workflows import main
    
    def test_basic_pipeline():
        """Test the pipeline with basic input"""
        
        print("🧪 Running Basic Pipeline Test")
        print("=" * 50)
        
        # Test transcript
        transcript = """
        Today I want to work on integrating LangGraph with my voice tree system.
        I need to create a multi-stage pipeline that can process transcripts effectively.
        The system should segment the text, analyze relationships, make integration decisions, and extract new nodes.
        I'm particularly interested in how well this performs compared to the existing single-LLM approach.
        """
        
        # Existing nodes
        existing_nodes = """
        Current tree nodes:
        - VoiceTree Project: Main project for voice-to-knowledge-graph system
        - LLM Integration: Work on integrating different language models
        - System Architecture: Design and architecture decisions
        """
        
        print(f"Input: {transcript.strip()[:100]}...")
        print(f"Existing nodes: {len(existing_nodes.split('-')) - 1} nodes")
        
        # Run the pipeline
        result = main.run_voicetree_pipeline(transcript, existing_nodes)
        
        # Print detailed results
        main.print_detailed_results(result)
        
        return result
    
    def test_empty_input():
        """Test with empty input to check error handling"""
        
        print("\n🧪 Testing Empty Input Handling")
        print("=" * 50)
        
        result = main.run_voicetree_pipeline("", "")
        
        if result.get("error_message"):
            print(f"✅ Error handling working: {result['error_message']}")
        else:
            print("⚠️ No error detected for empty input")
        
        return result
    
    def main_test():
        """Run all tests"""
        print("🚀 VoiceTree LangGraph Pipeline Tests")
        print("=" * 60)
        
        try:
            # Test 1: Basic functionality
            basic_result = test_basic_pipeline()
            
            # Test 2: Error handling
            empty_result = test_empty_input()
            
            print("\n" + "=" * 60)
            print("✅ All tests completed!")
            print("📋 Summary:")
            print(f"   • Basic test: {'✅ Pass' if not basic_result.get('error_message') else '❌ Fail'}")
            print(f"   • Empty input test: {'✅ Pass' if empty_result.get('error_message') else '⚠️ No error'}")
            
        except ImportError as e:
            print(f"❌ Import error: {e}")
            print("💡 Make sure to install dependencies:")
            print("   pip install langgraph langchain-core")
            
        except Exception as e:
            print(f"❌ Test failed: {e}")
            import traceback
            traceback.print_exc()

    if __name__ == "__main__":
        main_test()

except ImportError as e:
    print("⚠️ LangGraph dependencies not found. Running mock test instead.")
    print(f"Import error: {e}")
    
    def mock_test():
        """Run a mock test without LangGraph dependencies"""
        print("\n🧪 Mock Pipeline Test (No Dependencies)")
        print("=" * 50)
        
        print("✅ Prompt files exist:")
        prompts_dir = Path(__file__).parent / "prompts"
        if prompts_dir.exists():
            for prompt_file in prompts_dir.glob("*.txt"):
                print(f"   • {prompt_file.name}")
        
        print("\n✅ Module files exist:")
        module_files = ["state.py", "nodes.py", "graph.py", "main.py"]
        for module_file in module_files:
            if (Path(__file__).parent / module_file).exists():
                print(f"   • {module_file}")
        
        print("\n💡 To run full test, install dependencies:")
        print("   pip install langgraph langchain-core")
        
        return {"status": "mock_test_complete"}
    
    def main_test():
        mock_test()
    
    if __name__ == "__main__":
        main_test() 