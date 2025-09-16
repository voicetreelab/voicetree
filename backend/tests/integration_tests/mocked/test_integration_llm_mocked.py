# REMOVING FOR NOW, NOOOT THAT USEFUL WHEN WE HAVE THE E2E pipeline test with MOCKED AGENT

# import asyncio
# import os
# import shutil
# import unittest
# from unittest.mock import patch

# import pytest

# from backend.text_to_graph_pipeline.agentic_workflows.models import \
#     AppendAction, CreateAction
# from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import \
#     ChunkProcessor
# from backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow import \
#     WorkflowResult
# from backend.markdown_tree_manager.markdown_tree_ds import \
#     DecisionTree
# from backend.markdown_tree_manager.tree_to_markdown import \
#     TreeToMarkdownConverter


# class TestIntegrationMockedLLM(unittest.TestCase):
#     def setUp(self):
#         # Reset the tree and other objects before each test

#         self.decision_tree = DecisionTree()
#         # Use a relative path that works on all platforms
#         self.output_dir = os.path.join(os.path.dirname(__file__), "test_output")
#         self.converter = TreeToMarkdownConverter(self.decision_tree.tree)
#         self.processor = ChunkProcessor(self.decision_tree,
#                                        converter=self.converter,
#                                        output_dir=self.output_dir)
#         os.makedirs(self.output_dir, exist_ok=True)
        
#         # Clear any workflow state from previous tests
#         self.processor.clear_workflow_state()

#         log_file_path = "voicetree.log"  # todo change this from default, make it a test.log
#         if os.path.exists(log_file_path):
#             with open(log_file_path, 'w') as f:
#                 f.truncate()

#     def tearDown(self):
#         shutil.rmtree(self.output_dir, ignore_errors=True)

#     summaries = [
#         "## Project Planning Node\n\n- Define project scope.\n- Identify key stakeholders.",
#         "## Next Steps for Project\n\n- Need to reach out to investors for advice.\n- Will start with Austin's dad.",
#         "## Preparing for Investor Outreach\n\n- Polish Proof of Concept (POC):\n    - Refine user interface.\n    - "
#         "Improve summarization quality.\n    - Ensure application robustness and ease of use.\n- Prepare pitch deck "
#         "and presentation."
#     ]

#     @pytest.mark.asyncio
#     @patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionDeciderWorkflow.process_full_buffer')
#     async def test_complex_tree_creation_workflow(self, mock_process_full_buffer):
#         """Test complex tree creation using the new workflow system"""
        
#         # Mock workflow responses for each transcript processing
#         def mock_side_effect(*args, **kwargs):
#             call_num = mock_process_full_buffer.call_count - 1  # Subtract 1 because call_count has already been incremented
#             print(f"\nMock call #{call_num + 1}")
#             print(f"  transcript: {kwargs.get('transcript', args[0] if args else 'N/A')[:100]}...")
#             if call_num < len(mock_responses):
#                 response = mock_responses[call_num]
#                 print(f"  returning response with nodes: {response.new_nodes}")
#                 return response
#             else:
#                 # If we run out of mocked responses, return a default
#                 return WorkflowResult(success=False, new_nodes=[], tree_actions=[], error_message="No more mock responses")
            
#         mock_responses = [
#             # First transcript response
#             WorkflowResult(
#                 success=True,
#                 new_nodes=["Project Planning"],
#                 tree_actions=[CreateAction(
#                     action_type="create",
#                     action="CREATE",
#                     new_node_name="Project Planning",
#                     content=self.summaries[0],
#                     summary="Project planning and stakeholder identification",
#                     relationship="child of"
#                 )],
#                 metadata={"chunks_processed": 1}
#             ),
#             # Second transcript response - handles combined transcript 2 + 3
#             WorkflowResult(
#                 success=True,
#                 new_nodes=["Investor Outreach", "POC Polish"],
#                 tree_actions=[
#                     CreateAction(
#                         action_type="create",
#                         action="CREATE",
#                         new_node_name="Investor Outreach",
#                         content=self.summaries[1],
#                         summary="Reaching out to investors for advice",
#                         relationship="child of"
#                     ),
#                     CreateAction(
#                         action_type="create",
#                         action="CREATE",
#                         new_node_name="POC Polish",
#                         content=self.summaries[2],
#                         summary="Polish proof of concept for investor outreach",
#                         relationship="child of"
#                     )
#                 ],
#                 metadata={"chunks_processed": 2}
#             ),
#             # Third transcript response - empty since buffer handles the content
#             WorkflowResult(
#                 success=True,
#                 new_nodes=[],
#                 tree_actions=[],
#                 metadata={"chunks_processed": 0}
#             )
#         ]
        
#         mock_process_full_buffer.side_effect = mock_side_effect
        
#         # Test transcripts
#         transcript1 = """
#          This is a test of the VoiceTree application.
#          I want to create a new node about project planning. 
#          The first step is to define the project scope. 
#          The next step is to identify the key stakeholders.
#          """

#         transcript2 = (
#             "Another thing I will have to do is start reaching out to investors "
#             "to see what next steps they would recommend for me. "
#             "I should talk to Austin's dad first."
#         )

#         transcript3 = (
#             "To be able to start reaching out to investors, I will first have to polish my POC. "
#             "This involves refining the user interface, improving the summarization quality, "
#             "and making sure the application is robust and easy to use. "
#             "I'll also need to prepare a compelling pitch deck and presentation."
#         )

#         # Process the transcripts
#         print("Processing transcript 1...")
#         await self.processor.process_new_text_and_update_markdown(transcript1)
#         print(f"After transcript 1: nodes = {list(self.decision_tree.tree.keys())}")
        
#         print("Processing transcript 2...")
#         await self.processor.process_new_text_and_update_markdown(transcript2)
#         print(f"After transcript 2: nodes = {list(self.decision_tree.tree.keys())}")
        
#         print("Processing transcript 3...")
#         await self.processor.process_new_text_and_update_markdown(transcript3)
#         print(f"After transcript 3: nodes = {list(self.decision_tree.tree.keys())}")
        
#         # IMPORTANT: Process any remaining buffer content
#         remaining_buffer = self.processor.buffer_manager.get_buffer()
#         if remaining_buffer:
#             print(f"Processing remaining buffer: {len(remaining_buffer)} chars")
#             await self.processor.process_new_text(remaining_buffer)
        
#         # Finalize to ensure all nodes are converted to markdown
#         await self.processor.finalize()
#         print(f"After finalization: nodes = {list(self.decision_tree.tree.keys())}")
        
#         # Check mock call count
#         print(f"\nMock process_full_buffer called {mock_process_full_buffer.call_count} times")
        
#         # Assertions
#         tree = self.decision_tree.tree

#         # Debug: Print tree state
#         print(f"\nTree nodes: {list(tree.keys())}")
#         for node_id, node in tree.items():
#             print(f"  Node {node_id}: {node.title} (parent: {self.decision_tree.get_parent_id(node_id)})")

#         # 1. Check the Number of Nodes (should be 3 without root)
#         self.assertEqual(len(tree), 3, "The tree should have 3 nodes.")

#         # 2. Verify Node Content Using Keywords
#         project_planning_node_id = self.assert_node_content_contains(tree, ["project", "planning"])
#         investors_node_id = self.assert_node_content_contains(tree, ["investors", "austin"])
#         poc_node_id = self.assert_node_content_contains(tree, ["poc"])

#         # 3.  Check Parent-Child Relationships
#         # Project Planning should have no parent (it's the top-level node)
#         self.assertIsNone(self.decision_tree.get_parent_id(project_planning_node_id),
#                       "Node 'project planning' should have no parent.")
#         self.assertIn(investors_node_id, tree[project_planning_node_id].children,
#                       "Node 'investors' should be a child of 'project planning'.")
#         self.assertIn(poc_node_id, tree[investors_node_id].children,
#                       "Node 'polish my POC' should be a child of 'investors'.")

#         # 4. Verify Markdown File Creation and Links
#         for node_id, node_data in tree.items():
#             file_path = os.path.join(self.output_dir, node_data.filename)
#             self.assertTrue(os.path.exists(file_path), f"Markdown file for Node {node_id} not found.")

#             with open(file_path, "r") as f:
#                 content = f.read().lower()  # Convert content to lowercase
#                 # a Check for parent link
#                 parent_id = self.decision_tree.get_parent_id(node_id)
#                 if parent_id is not None:
#                     parent_filename = tree[parent_id].filename
#                     self.assertIn(f"- child of [[{parent_filename}]]".lower(), content,
#                                   # Convert expected link to lowercase
#                                   f"Missing child link to parent in Node {node_id} Markdown file.")
#                 for keyword in self.get_keywords_for_node(node_id):
#                     self.assertIn(keyword.lower(), content,
#                                   f"Keyword '{keyword}' not found in Node {node_id} Markdown file.")

#     # Update the test method names and remove the old patches
#     def test_complex_tree_creation(self):
#         """Test complex tree creation using workflow system"""
#         asyncio.run(self.test_complex_tree_creation_workflow())

#     @pytest.mark.asyncio
#     @patch('backend.text_to_graph_pipeline.chunk_processing_pipeline.tree_action_decider_workflow.TreeActionDeciderWorkflow.process_full_buffer')
#     async def test_complex_tree_creation_append_mode_workflow(self, mock_process_full_buffer):
#         """Test complex tree creation with APPEND mode using the new workflow system"""
        
#         # Mock workflow responses showing APPEND behavior
#         def mock_side_effect(*args, **kwargs):
#             call_num = mock_process_full_buffer.call_count - 1
#             if call_num < len(mock_responses):
#                 return mock_responses[call_num]
#             else:
#                 return WorkflowResult(success=False, new_nodes=[], tree_actions=[], error_message="No more mock responses")
                
#         mock_responses = [
#             # First transcript response
#             WorkflowResult(
#                 success=True,
#                 new_nodes=["Project Planning"],
#                 tree_actions=[CreateAction(
#                     action_type="create",
#                     action="CREATE",
#                     new_node_name="Project Planning",
#                     content=self.summaries[0],
#                     summary="Project planning and stakeholder identification",
#                     relationship="child of"
#                 )],
#                 metadata={"chunks_processed": 1}
#             ),
#             # Second transcript response - handles combined transcript 2 + 3
#             # APPEND to existing node then CREATE new node
#             WorkflowResult(
#                 success=True,
#                 new_nodes=["POC Polish"],  # Only the new node
#                 tree_actions=[
#                     AppendAction(
#                         action_type="append",
#                         action="APPEND",
#                         target_node_id=1,  # Assuming Project Planning has ID 1
#                         content=self.summaries[1]
#                     ),
#                     CreateAction(
#                         action_type="create",
#                         action="CREATE",
#                         new_node_name="POC Polish",
#                         content=self.summaries[2],
#                         summary="Polish proof of concept for investor outreach",
#                         relationship="child of"
#                     )
#                 ],
#                 metadata={"chunks_processed": 2}
#             ),
#             # Third transcript response - empty since buffer handles the content
#             WorkflowResult(
#                 success=True,
#                 new_nodes=[],
#                 tree_actions=[],
#                 metadata={"chunks_processed": 0}
#             )
#         ]
        
#         mock_process_full_buffer.side_effect = mock_side_effect
        
#         # Test transcripts
#         transcript1 = """
#          This is a test of the VoiceTree application.
#          I want to create a new node about project planning. 
#          The first step is to define the project scope. 
#          The next step is to identify the key stakeholders.
#          """

#         transcript2 = (
#             "Another thing I will have to do is start reaching out to investors "
#             "to see what next steps they would recommend for me. "
#             "I should talk to Austin's dad first."
#         )

#         transcript3 = (
#             "To be able to start reaching out to investors, I will first have to polish my POC. "
#             "This involves refining the user interface, improving the summarization quality, "
#             "and making sure the application is robust and easy to use. "
#             "I'll also need to prepare a compelling pitch deck and presentation."
#         )

#         # Process the transcripts
#         await self.processor.process_new_text_and_update_markdown(transcript1)
#         await self.processor.process_new_text_and_update_markdown(transcript2)
#         await self.processor.process_new_text_and_update_markdown(transcript3)
        
#         # IMPORTANT: Process any remaining buffer content
#         remaining_buffer = self.processor.buffer_manager.get_buffer()
#         if remaining_buffer:
#             await self.processor.process_new_text(remaining_buffer)
        
#         # Finalize to ensure all nodes are converted to markdown
#         await self.processor.finalize()
        
#         # Assertions
#         tree = self.decision_tree.tree

#         # 1. Check the Number of Nodes (should be 2 due to APPEND behavior and no root)
#         self.assertEqual(len(tree), 2, "The tree should have 2 nodes (due to APPEND and no root).")

#         # 2. Verify Node Content Using Keywords
#         project_planning_node_id = self.assert_node_content_contains(tree, ["project", "planning"]) 
#         investors_node_id = self.assert_node_content_contains(tree, ["investors", "austin"])
#         poc_node_id = self.assert_node_content_contains(tree, ["poc"])

#         # Since we are appending, investor_node_id should be the same as project planning node id
#         self.assertEqual(investors_node_id, project_planning_node_id)

#         # 3.  Check Parent-Child Relationship
#         # Project Planning should have no parent (it's the top-level node)
#         self.assertIsNone(self.decision_tree.get_parent_id(project_planning_node_id),
#                       "Node 'project planning' should have no parent.")
#         self.assertIn(poc_node_id, tree[investors_node_id].children,
#                       "Node 'polish my POC' should be a child of 'investors'.")

#         # 4. Verify Markdown File Creation and Links
#         for node_id, node_data in tree.items():
#             file_path = os.path.join(self.output_dir, node_data.filename)
#             self.assertTrue(os.path.exists(file_path), f"Markdown file for Node {node_id} not found.")

#             with open(file_path, "r") as f:
#                 content = f.read().lower()  # Convert content to lowercase
#                 # a Check for parent link
#                 parent_id = self.decision_tree.get_parent_id(node_id)
#                 if parent_id is not None:
#                     parent_filename = tree[parent_id].filename
#                     self.assertIn(f"- child of [[{parent_filename}]]".lower(), content,
#                                   # Convert expected link to lowercase
#                                   f"Missing child link to parent in Node {node_id} Markdown file.")
#                 for keyword in self.get_keywords_for_node(node_id):
#                     self.assertIn(keyword.lower(), content,
#                                   f"Keyword '{keyword}' not found in Node {node_id} Markdown file.")

#     def test_complex_tree_creation_append_mode(self):
#         """Test complex tree creation with APPEND mode using workflow system"""
#         asyncio.run(self.test_complex_tree_creation_append_mode_workflow())

#     # ... (Your helper functions) ...
#     # Helper functions to make assertions more readable and reusable
#     def assert_node_content_contains(self, tree, keywords):
#         """Asserts that a node with the given keywords exists in the tree."""
#         node_id = self.find_node_id_by_keywords(tree, keywords)
#         self.assertIsNotNone(node_id, f"Node with content containing '{keywords}' not found.")
#         return node_id

#     def find_node_id_by_keywords(self, tree, keywords):
#         """Finds the node ID based on the presence of all given keywords in the content."""
#         for node_id, node_data in tree.items():
#             if all(keyword.lower() in node_data.content.lower() for keyword in keywords):
#                 return node_id
#         return None

#     def get_keywords_for_node(self, node_id):
#         """Returns a list of keywords to check for in the Markdown file content."""
#         # Since we don't have a fixed root anymore, we need to check by content
#         tree = self.decision_tree.tree
#         if node_id in tree:
#             content = tree[node_id].content.lower()
#             if "project" in content and "planning" in content:
#                 return ["project", "planning"]
#             elif "investor" in content:
#                 return ["investor"]
#             elif "poc" in content:
#                 return ["poc"]
#         return []  # No specific keywords for other nodes

#     def print_tree(self, tree, node_id=0, indent=0):
#         """Prints a simple text-based representation of the tree."""
#         node_data = tree[node_id]
#         print("  " * indent + f"- {node_data.content}")
#         for child_id in node_data.children:
#             self.print_tree(tree, child_id, indent + 1)
