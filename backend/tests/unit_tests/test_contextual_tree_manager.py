import asyncio
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta
import time

import google.generativeai as genai

from settings import TRANSCRIPT_HISTORY_MULTIPLIER
from tree_manager.LLM_engine.summarize_with_llm import Summarizer
from tree_manager.LLM_engine.tree_action_decider import Decider
from tree_manager.text_to_tree_manager import ContextualTreeManager, \
    extract_complete_sentences
from tree_manager.decision_tree_ds import DecisionTree, Node


class TestContextualTreeManager(unittest.TestCase):
    # Mock Gemini API response
    mock_response_append = MagicMock(
        text="- Node ID: 2\n"
             "- Action: APPEND\n"
             "- Relationship: prereq for\n"
             "- Markdown Summary: ##title\n **Markdown Summary**\n - content"
    )
    mock_response_create = MagicMock(
        text="- Node ID: 1\n"
             "- Action: CREATE\n"
             "- Relationship: prereq for\n"
             "- Markdown Summary: ##title\n **This is a concise summary.**\n - content"
    )
    mock_response_summary = MagicMock(
        text="**This is a concise summary.**"
    )

    @patch("google.generativeai.GenerativeModel.generate_content_async", return_value=mock_response_append)
    def test_decide_tree_action_append(self, mock_generate_content):
        tree_manager = ContextualTreeManager(DecisionTree())
        tree_manager.decision_tree.tree = {
            0: Node(0, "Start", parent_id=None),
            1: Node(1, "**Node 1 content**", parent_id=0),
            2: Node(2, "Node 2 content", parent_id=0),
        }
        tree_manager.decision_tree.next_node_id = 3

        # tree_manager.modified_nodes = [0, 1, 2]  # No longer needed, use nodes directly

        async def run_test():
            mode, relationship, chosen_node_id, todo_summary = await Decider().decide_tree_action(tree_manager.decision_tree,
                                                                                  "Some new text",
                                                                                  "todo transcript_history")
            self.assertEqual(mode, "APPEND")
            self.assertEqual(chosen_node_id, 2)

        asyncio.run(run_test())
        mock_generate_content.assert_called_once()

    def test_extract_complete_sentences(self):
        tree_manager = ContextualTreeManager(DecisionTree())

        # Test case 1: Multiple complete sentences
        tree_manager.text_buffer = "This is a sentence. This is another one! Is this a question? And another"
        complete_sentences = extract_complete_sentences(tree_manager.text_buffer)
        self.assertEqual(complete_sentences, "This is a sentence. This is another one! Is this a question?")
        # self.assertEqual(tree_manager.text_buffer, "")

        # Test case 2:  Incomplete sentence
        tree_manager.text_buffer = "This is an incomplete sentence"
        complete_sentences = extract_complete_sentences(tree_manager.text_buffer)
        self.assertEqual(complete_sentences, "")
        # self.assertEqual(tree_manager.text_buffer, "This is an incomplete sentence")

        # Test case 3: Complete and incomplete sentences
        tree_manager.text_buffer = "Sentence one. Sentence two. More to come..."
        complete_sentences = extract_complete_sentences(tree_manager.text_buffer)
        self.assertEqual(complete_sentences, "Sentence one. Sentence two.")
        # self.assertEqual(tree_manager.text_buffer, "Incomplete...")

    @patch("google.generativeai.GenerativeModel.generate_content_async", return_value=mock_response_create)
    def test_decide_tree_action_create(self, mock_generate_content):
        tree_manager = ContextualTreeManager(DecisionTree())
        tree_manager.decision_tree.tree = {
            0: Node(0, "Start", parent_id=None),
            1: Node(1, "**Node 1 content**", parent_id=0),
        }
        tree_manager.decision_tree.next_node_id = 2

        # tree_manager.modified_nodes = [0, 1] # No longer needed

        async def run_test():
            mode, relationship, chosen_node_id, todo = await Decider().decide_tree_action(tree_manager.decision_tree,
                                                                                  "Some new text",
                                                                                  "todo")
            self.assertEqual(mode, "CREATE")
            self.assertEqual(chosen_node_id, 1)

        asyncio.run(run_test())
        mock_generate_content.assert_called_once()

    @patch("google.generativeai.GenerativeModel.generate_content_async", return_value=mock_response_summary)
    def test_summarize_with_llm(self, mock_generate_content):
        tree_manager = ContextualTreeManager(DecisionTree())
        summarizer = Summarizer()

        async def run_test():
            summary = await summarizer.summarize_with_llm("This is some text to summarize.",
                                                          "TODO: transcript history")
            self.assertEqual(summary, "**This is a concise summary.**")

        asyncio.run(run_test())

        mock_generate_content.assert_called_once()

    # todo need to also patch bg node resumm
    @patch.object(Summarizer, "summarize_with_llm", return_value="**This is a concise summary.**")
    @patch.object(Decider, "decide_tree_action", return_value=("APPEND", "", 1, "**This is a concise summary.**"))
    def test_process_voice_input_append(self, mock_analyze_context, mock_summarize):
        tree_manager = ContextualTreeManager(DecisionTree())
        tree_manager.decision_tree.tree = {
            0: Node(0, "Start", parent_id=None),
            1: Node(1, "**Node 1 content**", parent_id=0),
        }
        tree_manager.decision_tree.next_node_id = 2

        async def run_test():
            tree_manager.text_buffer_size_threshold = 20
            await tree_manager.process_voice_input("This is ")
            await tree_manager.process_voice_input("a test. 12345678901234567890 no full stop")
            await tree_manager.process_voice_input("Append to node 1.")

            # Wait for asynchronous operations to complete
            await asyncio.sleep(0.1)

            self.assertEqual(len(tree_manager.text_buffer), 0)
            self.assertEqual(tree_manager.decision_tree.tree[1].content,
                             "**Node 1 content**\n**This is a concise summary.**")
            self.assertIn(1, tree_manager.nodes_to_update)

        asyncio.run(run_test())

    @patch.object(Summarizer, "summarize_with_llm", return_value="**This is a concise summary.**")
    @patch.object(Decider, "decide_tree_action",
                  return_value=("CREATE","", 0, "**This is a concise summary.**"))  # Return "CREATE" and parent node ID
    def test_process_voice_input_create(self, mock_analyze_context, mock_summarize):
        tree_manager = ContextualTreeManager(DecisionTree())
        tree_manager.decision_tree.tree = {
            0: Node(0, "Start", parent_id=None)
        }
        tree_manager.decision_tree.next_node_id = 1

        async def run_test():
            tree_manager.text_buffer_size_threshold = 20
            await tree_manager.process_voice_input("This is ")
            await tree_manager.process_voice_input("a test. ")
            await tree_manager.process_voice_input("Create a new node.")

            await asyncio.sleep(0.1)

            self.assertEqual(len(tree_manager.text_buffer), 0)
            self.assertEqual(tree_manager.decision_tree.next_node_id, 2)  # next_node_id should be incremented
            self.assertIn(1, tree_manager.decision_tree.tree)  # Node 1 should be created
            self.assertEqual(tree_manager.decision_tree.tree[1].content, "**This is a concise summary.**")
            self.assertIn(1, tree_manager.nodes_to_update)  # Node 1 should be in nodes_to_update

        asyncio.run(run_test())

    @patch.object(Summarizer, "summarize_with_llm", return_value="**This is a concise summary.**")
    @patch.object(Decider, "decide_tree_action",
                  return_value=("CREATE", "", 0, ""))  # Return "CREATE" and parent node ID
    def test_transcript_history_management_advanced(self, mock_analyze_context, mock_summarize):
        tree_manager = ContextualTreeManager(DecisionTree())
        tree_manager.text_buffer_size_threshold = 10  # Example buffer size

        async def run_test():
            inputs = ["This is", "a test", "of the", "system.", "This is a longer string", "than the buffer size.",
                      "and an incredibly long string that just goes on without foresight nor reason to this world"]
            full_expected_history = ""  # Store the full expected history without truncation

            # Test with initially empty transcript_history
            self.assertEqual(tree_manager.transcript_history, "")

            for text in inputs:
                prev_buffer = tree_manager.text_buffer
                await tree_manager.process_voice_input(text)
                full_expected_history += text + " "

                # Assert history length
                self.assertLessEqual(len(tree_manager.transcript_history),
                                     tree_manager.text_buffer_size_threshold * (TRANSCRIPT_HISTORY_MULTIPLIER + 1))

                # Assert that transcript_history contains the correct *truncated* portion
                # of the full_expected_history
                expected_truncated_history = full_expected_history[
                                             -tree_manager.text_buffer_size_threshold * (
                                                     TRANSCRIPT_HISTORY_MULTIPLIER + 1):]
                self.assertEqual(tree_manager.transcript_history, expected_truncated_history)

                # history up to text chunk will not include text
                self.assertLessEqual(len(tree_manager.transcript_history_up_until_curr),
                                     max(tree_manager.text_buffer_size_threshold * (
                                             TRANSCRIPT_HISTORY_MULTIPLIER + 1) - len(
                                         text), 0))

                # a bit ugly
                last_buffer = prev_buffer + text

                self.assertFalse(last_buffer in tree_manager.transcript_history_up_until_curr)
                self.assertFalse(text in tree_manager.transcript_history_up_until_curr)
                self.assertTrue(len(tree_manager.transcript_history) > len(tree_manager.transcript_history_up_until_curr))
                self.assertTrue(len(tree_manager.transcript_history_up_until_curr) >= 0)

                # if len(last_buffer) <= tree_manager.text_buffer_size_threshold:
                #     self.assertEqual(tree_manager.transcript_history_up_until_curr + " ",
                #                      expected_truncated_history.replace(last_buffer, ""))
                # else:
                #     # can't use replace method
                #     self.assertEqual(tree_manager.transcript_history_up_until_curr,
                #                      expected_truncated_history[:-len(last_buffer + " ")])

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
