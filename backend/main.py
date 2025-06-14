import asyncio
import sys
import unittest

import process_transcription
from tree_manager.workflow_tree_manager import WorkflowTreeManager
from tree_manager.decision_tree_ds import DecisionTree
from tree_manager.tree_to_markdown import TreeToMarkdownConverter
from voice_to_text.voice_to_text import VoiceToTextEngine

decision_tree = DecisionTree()
tree_manager = WorkflowTreeManager(decision_tree, workflow_state_file="voicetree_workflow_state.json")
converter = TreeToMarkdownConverter(decision_tree.tree)
processor = process_transcription.TranscriptionProcessor(tree_manager,
                                                         converter)

async def main():
    voice_engine = VoiceToTextEngine()
    voice_engine.start_listening()
    while True:
        transcription = voice_engine.process_audio_queue()
        if transcription:
            await processor.process_and_convert(transcription)
        await asyncio.sleep(0.01)  # Small delay to prevent CPU spinning


if __name__ == "__main__":
    unit_tests = unittest.TestLoader().discover('tests/unit_tests')
    unit_tests_results = unittest.TextTestRunner().run(unit_tests)
    #
    # integration_tests = unittest.TestLoader().discover('tests/integration_tests/mocked')
    # integration_tests_results = unittest.TextTestRunner().run(integration_tests)

    # if not unit_tests_results.wasSuccessful() or not integration_tests_results:
    #     sys.exit("Unit tests failed. Exiting.")
    asyncio.run(main())
