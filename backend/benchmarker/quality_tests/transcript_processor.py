"""Transcript processing module for VoiceTree benchmarking."""

import os
import time
import logging
import hashlib
import tempfile

from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter

from .config import SECONDS_PER_REQUEST, OUTPUT_DIR
from .file_utils import clear_workflow_log, setup_output_directory


class TranscriptProcessor:
    """Handles processing of transcripts through the VoiceTree pipeline."""
    
    def __init__(self):
        self.decision_tree = None
        self.processor = None
        
    def _initialize_processor(self, transcript_file):
        """Initialize a fresh processor for a transcript."""
        # Reset the workflow I/O log for a clean run
        clear_workflow_log()
        
        # Create fresh instances for each transcript
        self.decision_tree = DecisionTree()
        
        # Use a unique state file in temp directory for each transcript to avoid cross-contamination
        temp_dir = tempfile.gettempdir()
        state_file_name = os.path.join(temp_dir, f"benchmark_workflow_state_{hashlib.md5(transcript_file.encode()).hexdigest()[:8]}.json")
        
        self.processor = ChunkProcessor(
            self.decision_tree, 
            converter=TreeToMarkdownConverter(self.decision_tree.tree),
            workflow_state_file=state_file_name,
            output_dir=OUTPUT_DIR
        )
        
        # Clear any existing workflow state before processing
        self.processor.clear_workflow_state()
        
        return state_file_name
    
    def _limit_content_by_words(self, content, max_words):
        """Limit content to a maximum number of words."""
        if max_words:
            words = content.split()
            if len(words) > max_words:
                content = ' '.join(words[:max_words])
                print(f"Limited transcript to {max_words} words")
        return content
    

    
    async def process_transcript(self, transcript_file, max_words=None):
        """Process a transcript file with VoiceTree using agentic workflow."""
        # Setup fresh output directory
        setup_output_directory()
        
        # Initialize processor
        state_file_name = self._initialize_processor(transcript_file)
        
        try:
            # Read and optionally limit transcript content
            with open(transcript_file, "r") as f:
                content = f.read()
            
            content = self._limit_content_by_words(content, max_words)
            
            # Process word by word to simulate streaming
            words = content.split()
            print(f"Processing {len(words)} words one at a time")
            
            for i, word in enumerate(words):
                # Send each word individually, like streaming voice
                await self.processor.process_and_convert(word + " ")
                
                # Small delay to simulate streaming (optional)
                if i % 10 == 0:  # Rate limit every 10 words
                    time.sleep(0.1)
            
            # FINALIZATION: Process any remaining text in the buffer
            # remaining_buffer = self.processor.buffer_manager.get_buffer()
            # if remaining_buffer:
            #     print(f"Processing remaining buffer content: {len(remaining_buffer)} chars")
            #     await self.processor.process_and_convert(remaining_buffer)
            
            # Convert all accumulated nodes to markdown
            # await self.processor.finalize() todo should be unnecessary
            
            # Log workflow statistics
            workflow_stats = self.processor.get_workflow_statistics()
            logging.info(f"Workflow statistics: {workflow_stats}")
            
        finally:
            # Clean up the temporary state file
            if os.path.exists(state_file_name):
                os.remove(state_file_name)