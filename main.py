import asyncio
import logging
import os
import tempfile

from backend.logging_config import setup_logging
from backend.text_to_graph_pipeline.agentic_workflows.core.debug_logger import \
    clear_debug_logs
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import \
    ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import \
    DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import \
    TreeToMarkdownConverter
from backend.text_to_graph_pipeline.voice_to_text.voice_to_text import \
    VoiceToTextEngine

# Configure logging
logger = setup_logging('voicetree.log', console_level=logging.ERROR)

# Create temp directory for workflow state
temp_dir = tempfile.mkdtemp()
workflow_state_file = os.path.join(temp_dir, "voicetree_workflow_state.json")

decision_tree = DecisionTree()
converter = TreeToMarkdownConverter(decision_tree.tree)
processor = ChunkProcessor(decision_tree, 
                          converter=converter)

async def main():
    # Clear debug logs at the start of each main.py run
    clear_debug_logs()
    
    voice_engine = VoiceToTextEngine()
    voice_engine.start_listening()
    
    # Get the event loop for running CPU-bound tasks
    loop = asyncio.get_event_loop()
    
    # Tasks to track ongoing operations
    transcription_task = None
    processing_task = None
    
    while True:
        # Non-blocking check for audio chunks
        audio_chunk = voice_engine.get_ready_audio_chunk()
        
        if audio_chunk is not None:
            # Cancel previous transcription if still running (optional)
            if transcription_task and not transcription_task.done():
                transcription_task.cancel()
            
            # Run transcription in thread pool to avoid blocking
            transcription_task = loop.run_in_executor(
                None,  # Use default thread pool
                voice_engine.transcribe_chunk,
                audio_chunk
            )
            
            # Create async task to handle transcription result
            async def handle_transcription():
                nonlocal processing_task
                try:
                    transcription = await transcription_task
                    if transcription:
                        # Cancel previous processing if still running
                        # (optional - remove if you want parallel processing and all the headaches that could come with it :D)
                        if processing_task and not processing_task.done():
                            processing_task.cancel()
                        
                        # Start processing in background
                        processing_task = asyncio.create_task(
                            processor.process_new_text_and_update_markdown(transcription)
                        )
                except asyncio.CancelledError:
                    pass
                except Exception as e:
                    logger.error(f"Error handling transcription: {e}")
            
            # Schedule transcription handling without blocking
            asyncio.create_task(handle_transcription())
        
        await asyncio.sleep(0.01)  # Small delay to prevent CPU spinning


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        # Clean up temp files
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
