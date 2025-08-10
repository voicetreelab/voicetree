"""Transcript processing module for VoiceTree benchmarking."""

import asyncio
import hashlib
import os
import tempfile
import time

from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import \
    ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import \
    DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import \
    TreeToMarkdownConverter

from .config import OUTPUT_DIR
from .file_utils import clear_workflow_log, setup_output_directory


class TranscriptProcessor:
    """Handles processing of transcripts through the VoiceTree pipeline."""
    
    def __init__(self):
        self.decision_tree = None
        self.processor = None
        
    def _initialize_processor(self, transcript_file, output_subdirectory=None):
        """Initialize a fresh processor for a transcript.
        
        Args:
            transcript_file: Transcript file identifier
            output_subdirectory: Optional subdirectory name for transcript-specific output
        """
        # Reset the workflow I/O log for a clean run
        clear_workflow_log()
        
        # Create fresh instances for each transcript
        self.decision_tree = DecisionTree()
        
        # Use a unique state file in temp directory for each transcript to avoid cross-contamination
        temp_dir = tempfile.gettempdir()
        state_file_name = os.path.join(temp_dir, f"benchmark_workflow_state_{hashlib.md5(transcript_file.encode()).hexdigest()[:8]}.json")
        
        # Determine output directory
        if output_subdirectory:
            output_dir = os.path.join(OUTPUT_DIR, output_subdirectory)
        else:
            output_dir = OUTPUT_DIR
            
        self.processor = ChunkProcessor(
            self.decision_tree, 
            converter=TreeToMarkdownConverter(self.decision_tree.tree),
            output_dir=output_dir
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
    

    
    async def process_content(self, content, transcript_identifier, processing_mode="word", output_subdirectory=None):
        """Process transcript content with VoiceTree using agentic workflow.
        
        Args:
            content: Text content to process
            transcript_identifier: Unique identifier for this transcript
            processing_mode: "word" for 30-word chunks or "line" for line-by-line processing
            output_subdirectory: Optional subdirectory name under OUTPUT_DIR for transcript-specific output
        """
        # Setup fresh output directory (with optional subdirectory)
        if output_subdirectory:
            transcript_output_dir = os.path.join(OUTPUT_DIR, output_subdirectory)
            setup_output_directory(transcript_output_dir, transcript_identifier=transcript_identifier)
        else:
            setup_output_directory()
        
        # Initialize processor with appropriate output directory
        state_file_name = self._initialize_processor(transcript_identifier, output_subdirectory)
        
        try:
            if processing_mode == "line":
                # Process line by line
                lines = content.strip().split('\n')
                # print(f"Processing {len(lines)} lines ({len(content)} chars total)")
                
                for i, line in enumerate(lines):
                    print(f"Transcribed:{line}")
                    if line.strip():  # Skip empty lines
                        # Send each line as a chunk
                        await self.processor.process_new_text_and_update_markdown(line.strip() + "\n")
                        
                        # Small delay to simulate streaming (optional)
                        # await asyncio.sleep(10)
                        
                        if (i + 1) % 10 == 0:  # Progress indicator every 10 lines
                            print(f"Processed {i + 1}/{len(lines)} lines")
            else:
                # Default: Process 30 words at a time to simulate streaming
                words = content.split()
                print(f"Processing {len(words)} words ({len(content)} chars total)")
                
                # Process in chunks of 30 words
                chunk_size = 30
                for i in range(0, len(words), chunk_size):
                    chunk = words[i:i + chunk_size]
                    chunk_text = ' '.join(chunk) + " "
                    
                    # Send chunk of 30 words
                    await self.processor.process_new_text_and_update_markdown(chunk_text)
                    
                    # Small delay to simulate streaming (optional)
                    await asyncio.sleep(0.05)
            
            # FINALIZATION: Process any remaining text in the buffer
            # remaining_buffer = self.processor.buffer_manager.get_buffer()
            # if remaining_buffer:
                # print(f"Processing remaining buffer: {len(remaining_buffer)} chars")
                
                # Get transcript history for context
                # transcript_history = self.processor.buffer_manager.get_transcript_history()
                
                # Directly process the remaining buffer as a chunk, bypassing the buffer manager
                # await self.processor._process_text_chunk(remaining_buffer, transcript_history)
                
                # Clear the buffer since we processed it
                # self.processor.buffer_manager.clear()
            
            # Convert all accumulated nodes to markdown
            # await self.processor.finalize()
            
            # Log workflow statistics
            workflow_stats = self.processor.get_workflow_statistics()
            print(f"Completed. Stats: {workflow_stats}")
            
        finally:
            # Clean up the temporary state file
            if os.path.exists(state_file_name):
                os.remove(state_file_name)
    
