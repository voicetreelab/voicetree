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

async def transcription_loop(voice_engine, text_queue):
    """Continuously transcribe audio and put text into queue"""
    executor = ThreadPoolExecutor(max_workers=4)  # Increased to allow parallel transcriptions
    
    try:
        while True:
            audio_chunk = voice_engine.get_ready_audio_chunk()
            
            if audio_chunk is not None:
                logger.info("Got audio chunk, transcribing...")
                # Transcribe in thread pool
                loop = asyncio.get_event_loop()
                transcription = await loop.run_in_executor(
                    executor, voice_engine.transcribe_chunk, audio_chunk
                )
                
                if transcription:
                    logger.info(f"Transcribed: {transcription[:50]}...")
                    await text_queue.put(transcription)
                    logger.info(f"Queue size: {text_queue.qsize()}")
            
            await asyncio.sleep(0.01)
    finally:
        executor.shutdown(wait=True)


async def llm_processing_loop(text_queue, processor):
    """Process text from queue through LLM pipeline"""
    executor = ThreadPoolExecutor(max_workers=1)
    
    def run_blocking_async(processor, text):
        """Run the blocking async function in a new event loop"""
        return asyncio.run(processor.process_new_text_and_update_markdown(text))
    
    try:
        while True:
            # Wait for text from queue
            logger.info(f"Waiting for text from queue, size: {text_queue.qsize()}")
            transcription = await text_queue.get()
            logger.info(f"Got text from queue: {transcription[:50]}...")
            
            try:
                # Process through LLM pipeline in a separate thread
                # This prevents blocking operations from freezing the main event loop
                logger.info("Starting LLM processing in background thread...")
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(
                    executor,
                    run_blocking_async,
                    processor,
                    transcription
                )
                logger.info("LLM processing complete")
            except Exception as e:
                logger.error(f"Error processing text: {e}")
                # Continue processing next items even if one fails
            
    except asyncio.CancelledError:
        raise
    finally:
        executor.shutdown(wait=True)


async def main():
    # Clear debug logs at the start of each main.py run
    clear_debug_logs()
    
    voice_engine = VoiceToTextEngine()
    voice_engine.start_listening()
    
    # Queue for passing text from transcription to LLM processing
    text_queue = asyncio.Queue()
    
    # Create tasks
    transcription_task = asyncio.create_task(
        transcription_loop(voice_engine, text_queue)
    )
    llm_task = asyncio.create_task(
        llm_processing_loop(text_queue, processor)
    )
    
    try:
        # Run both tasks concurrently
        await asyncio.gather(transcription_task, llm_task)
    finally:
        # Cleanup
        voice_engine.stop()
        transcription_task.cancel()
        llm_task.cancel()
        await asyncio.gather(transcription_task, llm_task, return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        # Clean up temp files
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
