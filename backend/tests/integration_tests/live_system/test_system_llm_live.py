import asyncio
import time
import unittest
import os
import shutil  # For directory operations

import process_transcription
from tree_manager.text_to_tree_manager import ContextualTreeManager
from tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.tree_to_markdown import TreeToMarkdownConverter

class TestIntegration(unittest.TestCase):
    def setUp(self):
        self.decision_tree = DecisionTree()
        self.tree_manager = ContextualTreeManager(self.decision_tree)
        self.converter = TreeToMarkdownConverter(self.decision_tree.tree)
        self.output_dir = "/Users/bobbobby/repos/VoiceTreePoc/test_output"
        self.cleanUp()
        self.processor = process_transcription.TranscriptionProcessor(self.tree_manager,

                                                      self.converter,
                                                                      self.output_dir)
        os.makedirs(self.output_dir, exist_ok=True)
        log_file_path = "voicetree.log"
        if os.path.exists(log_file_path):
            with open(log_file_path, 'w') as f:
                f.truncate()

    def cleanUp(self):
        # Clean up the test output directory
        shutil.rmtree(self.output_dir, ignore_errors=True)
        return


    async def run_complex_tree_creation(self):  # Make the test logic asynchronous
        transcript1 = """
        This is a test of the VoiceTree application.
        I want to create a new node about project planning. 
        The first step is to define the project scope. 
        The next step is to identify the key stakeholders.
        """

        transcript2 = (
            "Another thing I will have to do is start reaching out to investors "
            "to see what next steps they would recommend for me. "
            "I should talk to Austin's dad first."
        )

        transcript3 = (
            "To be able to start reaching out to investors, I will first have to polish my POC. "
            "This involves refining the user interface, improving the summarization quality, "
            "and making sure the application is robust and easy to use. "
            "I'll also need to prepare a compelling pitch deck and presentation."
        )

        # Process the transcripts
        await self.processor.process_and_convert(transcript1)
        await self.processor.process_and_convert(transcript2)
        await self.processor.process_and_convert(transcript3)

        # Assertions
        tree = self.tree_manager.decision_tree.tree

        # print(tree)

        # self.print_tree(tree)

        # 1. Check the Number of Nodes
        # - We expect at least 3 nodes: root, project planning, and polishing the POC.
        # - The LLM might create a separate node for "reaching out to investors" or append it to an existing node.
        self.assertGreaterEqual(len(tree), 3, "The tree should have at least 3 nodes.")

        # 2. Verify Node Content Using Keywords (more robust than exact string matching)
        project_planning_node_id = self.assert_node_content_contains(tree, ["project", "planning"])
        investors_node_id = self.assert_node_content_contains(tree, ["investor"])
        poc_node_id = self.assert_node_content_contains(tree, ["poc"])

        # 3.  Check Parent-Child Relationship
        root_node_children = tree[0].children
        investor_node_children = tree[investors_node_id].children
        self.assertIn(1, root_node_children, "Node 1 (project planning) should be a child of the root node.")

        # # Node 2 (investors) could be a child of the root or another node, so we'll find it dynamically
        # node_2_id = self.find_node_id_by_keywords(tree, ["investors", "austin"])
        # self.assertIsNotNone(node_2_id, "Node with content about 'reaching out to investors' not found.")
        #
        # # Node 3 (polish POC) should always be a child of Node 1
        # self.assertIn(3, tree[1].children, "Node 3 (polish POC) should be a child of Node 1.")
        #

        # assert for two possible tree structures

        # FIRST POSSIBLE, investor_node == project_planning_node, because APPEND

        # root <-> investor_node <-> poc_node ;

        # SECOND POSSIBLE, investor_node <-> project_planning_node, because CREATE

        # root <-> project_planning <-> investor_node <-> poc_node

        # Assert for the two possible tree structures:
        if investors_node_id == project_planning_node_id:
            # Case 1: APPEND - investors content appended to project planning node
            print("LLM FAVOURED APPEND MODE")
            self.assertEqual(len(tree), 3, "Only 3 nodes should exist if 'investors' content was appended.")
            self.assertIn(poc_node_id, tree[project_planning_node_id].children, "Node 'polish my POC' should be a child of 'project planning'.")
        else:
            # Case 2: CREATE - a separate node was created for investors
            print("LLM FAVOURED CREATE MODE")
            self.assertEqual(len(tree), 4, "4 nodes should exist if 'investors' content created a new node.")
            self.assertIn(poc_node_id, tree[investors_node_id].children, "Node 'polish my POC' should be a child of 'investors'.")

        # 4. Verify Markdown File Creation and Links
        for node_id, node_data in tree.items():
            file_path = os.path.join(self.output_dir, node_data.filename)
            self.assertTrue(os.path.exists(file_path), f"Markdown file for Node {node_id} not found.")

            with open(file_path, "r") as f:
                content = f.read().lower()  # Convert content to lowercase
                #a Check for parent link
                parent_id = self.tree_manager.decision_tree.get_parent_id(node_id)
                if parent_id is not None:
                    parent_filename = tree[parent_id].filename
                    relationship = tree[node_id].relationships[parent_id]
                    self.assertIn(f"{relationship} [[{parent_filename}]]".lower(), content,
                                  # Convert expected link to lowercase
                                  f"Missing child link to parent in Node {node_id} Markdown file.")
                for keyword in self.get_keywords_for_node(node_id):
                    self.assertIn(keyword.lower(), content,
                              f"Keyword '{keyword}' not found in Node {node_id} Markdown file.")

    def test_complex_tree_creation(self):
        asyncio.run(self.run_complex_tree_creation()) # Run the test in an event loop

    # Helper functions to make assertions more readable and reusable
    def assert_node_content_contains(self, tree, keywords):
        """Asserts that a node with the given keywords exists in the tree."""
        node_id = self.find_node_id_by_keywords(tree, keywords)
        self.assertIsNotNone(node_id, f"Node with content containing '{keywords}' not found.")
        return node_id
    def find_node_id_by_keywords(self, tree, keywords):
        """Finds the node ID based on the presence of all given keywords in the content."""
        for node_id, node_data in tree.items():
            if node_data.content:
                if all(keyword.lower() in node_data.content.lower() for keyword in keywords):
                    return node_id
        return None

    def get_keywords_for_node(self, node_id):
        """Returns a list of keywords to check for in the Markdown file content."""
        if node_id == 0:
            return ["today"]  # Keywords for the root node
        elif node_id == 1:
            return ["project", "planning"]
        elif node_id == 2:
            return ["investor"]
        elif node_id == 3:
            return ["poc"]
        else:
            return []  # No specific keywords for other nodes