#!/usr/bin/env python3
"""
Simple script to test the VoiceTree LangGraph pipeline with real LLM integration
"""

import sys
import os
from pathlib import Path

# Add the current directory to the Python path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

# Import the main module
from main import run_voicetree_pipeline, print_detailed_results

def main():
    """Run a simple test of the VoiceTree LangGraph pipeline"""
    
    print("🧪 Testing VoiceTree LangGraph Pipeline with Real LLM")
    print("=" * 60)
    
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
    result = run_voicetree_pipeline(transcript, existing_nodes)
    
    # Print detailed results
    print_detailed_results(result)
    
    return result

if __name__ == "__main__":
    main()
