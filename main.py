import asyncio
import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor

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
    
    # Thread pool for CPU-intensive transcription
    executor = ThreadPoolExecutor(max_workers=2)
    
    # Limit concurrent text processing tasks for backpressure
    max_concurrent_processing = 1
    processing_tasks = set()
    
    try:
        while True:
            # Non-blocking audio chunk retrieval
            audio_chunk = voice_engine.get_ready_audio_chunk()
            
            if audio_chunk is not None:
                # CPU-intensive transcription in thread pool (non-blocking)
                loop = asyncio.get_event_loop()
                transcription = await loop.run_in_executor(
                    executor, voice_engine.transcribe_chunk, audio_chunk
                )
                
                if transcription:
                    # Network-bound processing as fire-and-forget task
                    if len(processing_tasks) < max_concurrent_processing:
                        task = asyncio.create_task(
                            processor.process_new_text_and_update_markdown(transcription)
                        )
                        processing_tasks.add(task)
                        task.add_done_callback(processing_tasks.discard)
                    else:
                        # Backpressure: wait for oldest task to complete
                        done, processing_tasks = await asyncio.wait(
                            processing_tasks, return_when=asyncio.FIRST_COMPLETED
                        )
            
            # Clean up completed tasks
            processing_tasks = {t for t in processing_tasks if not t.done()}
            
            await asyncio.sleep(0.01)
    finally:
        # Cleanup
        executor.shutdown(wait=True)
        voice_engine.stop()
        if processing_tasks:
            await asyncio.gather(*processing_tasks, return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        # Clean up temp files
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
