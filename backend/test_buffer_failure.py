#!/usr/bin/env python3
"""Test to reproduce the buffer failure"""

import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from text_to_graph_pipeline.chunk_processing_pipeline import ChunkProcessor
from text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from typing import Dict, Any, Optional


class DebugMockAgent:
    """Mock agent that logs what it receives and returns"""
    
    async def run(
        self,
        transcript: str,
        transcript_history: Optional[str] = None,
        existing_nodes: Optional[str] = None
    ) -> Dict[str, Any]:
        print(f"\n=== Mock Agent Called ===")
        print(f"Transcript: '{transcript}'")
        print(f"Transcript length: {len(transcript)}")
        
        # Return empty chunks to trigger the issue
        result = {
            "chunks": [],  # Empty chunks array
            "integration_decisions": [],
            "current_stage": "complete",
            "error_message": None
        }
        
        print(f"Returning: {result}")
        return result


async def test_empty_chunks():
    """Test what happens when workflow returns empty chunks"""
    
    # Create components
    decision_tree = DecisionTree()
    mock_agent = DebugMockAgent()
    
    # Create ChunkProcessor with debug agent
    chunk_processor = ChunkProcessor(
        decision_tree=decision_tree,
        output_dir="test_output",
        agent=mock_agent
    )
    
    # Send text that's long enough to trigger buffer flush (>183 chars)
    test_text = "This is a test sentence that needs to be long enough to trigger the buffer flush mechanism. " * 3
    
    print(f"Sending text of length {len(test_text)}")
    
    try:
        await chunk_processor.process_new_text_and_update_markdown(test_text)
        print("\nTest completed successfully!")
    except Exception as e:
        print(f"\nERROR: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_empty_chunks())