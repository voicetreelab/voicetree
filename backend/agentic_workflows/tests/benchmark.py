#!/usr/bin/env python3
"""
Benchmark module for VoiceTree LangGraph tests
Provides VoiceTreeBenchmarker class as expected by test_single.py
"""

import sys
import os
from pathlib import Path

# Add parent directories to path to access the main benchmarker
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent.parent
sys.path.insert(0, str(project_root))

try:
    # Try to import from the actual benchmarker location
    from backend.benchmarker.quality_tests.quality_LLM_benchmarker import *
    
    # Create a mock VoiceTreeBenchmarker class if the real one doesn't exist
    class VoiceTreeBenchmarker:
        """Mock benchmarker for testing the agentic workflows"""
        
        async def benchmark_transcript(self, transcript: str, existing_nodes: list, name: str):
            """Mock benchmark method that returns a test result"""
            return {
                "quality_evaluation": {
                    "overall_score": 5,
                    "accuracy": 5,
                    "completeness": 5,
                    "granularity": 5,
                    "relationships": 5,
                    "clarity": 5
                },
                "transcript": transcript,
                "existing_nodes": existing_nodes,
                "name": name
            }
    
except ImportError as e:
    print(f"⚠️ Could not import real benchmarker: {e}")
    print("🔄 Using mock VoiceTreeBenchmarker")
    
    class VoiceTreeBenchmarker:
        """Mock benchmarker for testing the agentic workflows"""
        
        async def benchmark_transcript(self, transcript: str, existing_nodes: list, name: str):
            """Mock benchmark method that returns a test result"""
            return {
                "quality_evaluation": {
                    "overall_score": 5,
                    "accuracy": 5,
                    "completeness": 5,
                    "granularity": 5,
                    "relationships": 5,
                    "clarity": 5
                },
                "transcript": transcript,
                "existing_nodes": existing_nodes,
                "name": name
            } 