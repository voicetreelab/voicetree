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
                          converter=converter, 
                          workflow_state_file=workflow_state_file)

async def main():
    # Clear debug logs at the start of each main.py run
    clear_debug_logs()
    
    voice_engine = VoiceToTextEngine()
    voice_engine.start_listening()
    
    while True:
        transcription = voice_engine.process_audio_queue()
        if transcription:
            # Use the async version directly - no thread pool needed
            await processor.process_new_text_and_update_markdown(transcription)
        await asyncio.sleep(0.01)  # Small delay to prevent CPU spinning  # Small delay to prevent CPU spinning


if __name__ == "__main__":
    # unit_tests = unittest.TestLoader().discover('backend/tests/unit_tests')
    # unit_tests_results = unittest.TextTestRunner().run(unit_tests)
    #
    # integration_tests = unittest.TestLoader().discover('tests/integration_tests/mocked')
    # integration_tests_results = unittest.TextTestRunner().run(integration_tests)

    # if not unit_tests_results.wasSuccessful() or not integration_tests_results:
    #     sys.exit("Unit tests failed. Exiting.")
    
    try:
        asyncio.run(main())
    finally:
        # Clean up temp files
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
