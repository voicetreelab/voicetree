import asyncio
import unittest

from backend.text_to_graph_pipeline.tree_manager.future import create_enhanced_transcription_processor
from backend.tree_manager.decision_tree_ds import DecisionTree
from voice_to_text.voice_to_text import VoiceToTextEngine

# Create enhanced system with TADA + TROA
decision_tree = DecisionTree()
processor = create_enhanced_transcription_processor(
    decision_tree=decision_tree,
    workflow_state_file="voicetree_enhanced_state.json",
    enable_background_optimization=True,
    optimization_interval_minutes=2
)

async def main():
    voice_engine = VoiceToTextEngine()
    voice_engine.start_listening()
    
    # Start enhanced processing system
    await processor.enhanced_tree_manager.start_enhanced_processing()
    
    try:
        while True:
            transcription = voice_engine.process_audio_queue()
            if transcription:
                await processor.process_and_convert(transcription)
            await asyncio.sleep(0.01)  # Small delay to prevent CPU spinning
    finally:
        # Finalize processing and stop background optimization
        await processor.finalize()
        await processor.enhanced_tree_manager.stop_enhanced_processing()


if __name__ == "__main__":
    unit_tests = unittest.TestLoader().discover('tests/unit_tests')
    unit_tests_results = unittest.TextTestRunner().run(unit_tests)
    #
    # integration_tests = unittest.TestLoader().discover('tests/integration_tests/mocked')
    # integration_tests_results = unittest.TextTestRunner().run(integration_tests)

    # if not unit_tests_results.wasSuccessful() or not integration_tests_results:
    #     sys.exit("Unit tests failed. Exiting.")
    asyncio.run(main())
