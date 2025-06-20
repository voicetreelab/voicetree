import asyncio
import logging
import unittest
from unittest.mock import patch, AsyncMock

from tree_manager.LLM_engine.background_rewrite import Rewriter
from tree_manager.decision_tree_ds import DecisionTree
from tree_manager.utils import extract_summary


class TestRewriter(unittest.TestCase):
    pass
    # @patch("tree_manager.LLM_engine.background_rewrite.generate_async", new_callable=AsyncMock)
    # def test_rewrite_node_in_background(self, mock_generate_async):
    #     """Tests the rewrite_node_in_background method."""
    #     decision_tree = DecisionTree()
    #     node_id = decision_tree.create_new_node(0, "## Original Content\n- Some point", relationship_to_parent="")
    #     decision_tree.tree[node_id].transcript_history = "This is some transcript history."
    #
    #     # Mock LLM response
    #     mock_generate_async.return_value.text = "## Rewritten Title\n**Mock Summary**\n#### Section\n- Rewritten point"
    #
    #     rewriter = Rewriter()
    #
    #     async def run_test():
    #         await rewriter.rewrite_node_in_background(decision_tree, node_id)
    #
    #         # Assertions
    #         self.assertEqual(decision_tree.tree[node_id].content,
    #                          "## Rewritten Title\n**Mock Summary**\n#### Section\n- Rewritten point")
    #         self.assertEqual(decision_tree.tree[node_id].summary, "Mock Summary")
    #         mock_generate_async.assert_awaited_once()  # No need to check prompt content, done in other test
    #
    #     asyncio.run(run_test())
    #
    # @patch("tree_manager.LLM_engine.background_rewrite.generate_async", new_callable=AsyncMock)
    # def test_rewrite_node(self, mock_generate_async):
    #     """Tests the _rewrite_node method."""
    #     node_content = "## Test Node\nSome content"
    #     context = "Some context for rewriting."
    #
    #     # Mock LLM response
    #     mock_generate_async.return_value.text = "## Rewritten Node\n**Better Content**\n- Point 1"
    #
    #     rewriter = Rewriter()
    #
    #     async def run_test():
    #         rewritten_content = await rewriter._rewrite_node(node_content, context)
    #
    #         self.assertEqual(rewritten_content, "## Rewritten Node\n**Better Content**\n- Point 1")
    #         mock_generate_async.assert_awaited_once()  # Check prompt content above
    #
    #     asyncio.run(run_test())
    #
if __name__ == '__main__':
    unittest.main()