#!/usr/bin/env python3
import asyncio
import sys
import os
import tempfile
import shutil

# Add project root to path
sys.path.insert(0, '.')

from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter

async def process_transcript():
    # Initialize components
    decision_tree = DecisionTree()
    converter = TreeToMarkdownConverter(decision_tree.tree)
    
    # Use temp file for workflow state
    temp_dir = tempfile.mkdtemp()
    workflow_state_file = os.path.join(temp_dir, "test_workflow_state.json")
    
    processor = ChunkProcessor(
        decision_tree,
        converter=converter,
        workflow_state_file=workflow_state_file,
        output_dir="markdownTreeVault/2025-06-22"  # Explicitly set relative path
    )
    
    # Read transcript
    with open('transcript.txt', 'r') as f:
        transcript = f.read()
    
    print("Processing transcript...")
    print(f"Output directory: {processor.output_dir}")
    
    # Process the entire transcript
    await processor.process_and_convert(transcript)
    
    print(f"\nProcessing complete!")
    print(f"Total nodes created: {len(decision_tree.tree)}")
    print(f"Check output in: {processor.output_dir}")
    
    # List created files
    if os.path.exists(processor.output_dir):
        files = os.listdir(processor.output_dir)
        if files:
            print(f"\nCreated {len(files)} markdown files:")
            for f in sorted(files):
                print(f"  - {f}")
        else:
            print("\nNo files created yet.")
    
    # Return temp_dir for cleanup
    return temp_dir

if __name__ == "__main__":
    temp_dir = None
    try:
        temp_dir = asyncio.run(process_transcript())
    finally:
        # Clean up temp files
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)