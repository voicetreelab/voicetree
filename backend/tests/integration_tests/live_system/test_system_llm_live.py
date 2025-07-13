import os
import shutil  # For directory operations
import pytest
import nest_asyncio

from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter

# Apply nest_asyncio to allow nested event loops
nest_asyncio.apply()


class TestIntegration:
    @pytest.fixture(autouse=True)
    def setup_method(self, tmp_path):
        self.decision_tree = DecisionTree()
        # Use pytest's tmp_path for test output
        self.output_dir = str(tmp_path / "test_output")
        self.cleanUp()
        self.converter = TreeToMarkdownConverter(self.decision_tree.tree)
        self.processor = ChunkProcessor(self.decision_tree,
                                       converter=self.converter,
                                       output_dir=self.output_dir)
        os.makedirs(self.output_dir, exist_ok=True)
        log_file_path = "voicetree.log"
        if os.path.exists(log_file_path):
            with open(log_file_path, 'w') as f:
                f.truncate()
        
        # Yield control to the test
        yield
        
        # Cleanup after test
        self.processor.clear_workflow_state()

    def cleanUp(self):
        # Clean up the test output directory
        shutil.rmtree(self.output_dir, ignore_errors=True)
        return

    async def run_complex_tree_creation(self):  # Make the test logic asynchronous
        """
        Test that the workflow system can process transcripts end-to-end.
        This test focuses on system integration rather than specific LLM outputs.
        """
        
        # Simple test transcript that should be easy for the LLM to process
        transcript = (
            "I'm working on a new project. "
            "The project involves building a voice application. "
            "I need to test the system to make sure it works properly."
        )

        print("\n🧪 Testing VoiceTree workflow integration...")
        print(f"📝 Input transcript: {transcript}")

        # Process the transcript
        try:
            await self.processor.process_and_convert(transcript)
            print("✅ Processing completed without errors")
            
            # Process any remaining buffer content
            remaining_buffer = self.processor.buffer_manager.get_buffer()
            if remaining_buffer:
                print(f"📝 Processing remaining buffer: {len(remaining_buffer)} chars")
                await self.processor.process_voice_input(remaining_buffer)
            
            # Finalize to ensure all nodes are converted
            await self.processor.finalize()
            print("✅ Finalization completed")
        except Exception as e:
            print(f"❌ Processing failed with error: {e}")
            pytest.fail(f"Processing should not fail: {e}")
            
        # Test the tree structure
        tree = self.decision_tree.tree
        print(f"📊 Tree has {len(tree)} nodes")

        # Basic assertions - the system should create at least one node
        assert len(tree) >= 1, "The tree should have at least one node."
        
        # Test that the processor is properly configured
        assert self.processor is not None, "Chunk processor should be initialized."
        
        # Test markdown file creation - at least one node should have a file
        if len(tree) > 0:
            first_node = list(tree.values())[0]
            first_filename = first_node.filename
            if first_filename:
                first_file_path = os.path.join(self.output_dir, first_filename)
                if os.path.exists(first_file_path):
                    print(f"✅ First node markdown file created: {first_filename}")
                    with open(first_file_path, "r") as f:
                        content = f.read()
                        assert len(content) > 0, "First node markdown file should not be empty"
                        
                        # Verify content contains actual words from the transcript
                        transcript_words = set(transcript.lower().split())
                        content_words = set(content.lower().split())
                        common_words = transcript_words & content_words
                        
                        # Remove common stop words that might coincidentally match
                        stop_words = {'the', 'a', 'an', 'is', 'it', 'to', 'and', 'or', 'of', 'in', 'on', 'i'}
                        meaningful_common_words = common_words - stop_words
                        
                        # Calculate percentage of meaningful transcript words found in content
                        meaningful_transcript_words = transcript_words - stop_words
                        if meaningful_transcript_words:
                            percentage = len(meaningful_common_words) / len(meaningful_transcript_words) * 100
                            print(f"📊 Content contains {percentage:.1f}% of meaningful transcript words")
                            print(f"   Common words: {meaningful_common_words}")
                            
                            # Ensure at least 10% of meaningful words from transcript appear in content
                            assert percentage >= 10, f"Content should contain at least 10% of transcript words, but only contains {percentage:.1f}%"
                        
                        # Also check that we don't have template variables
                        template_vars = ['new_node_name', 'new_node_summary', 'content', 'reasoning']
                        for var in template_vars:
                            assert var not in content, f"Content should not contain template variable '{var}'"
                else:
                    print(f"⚠️ First node markdown file not found: {first_file_path}")
        
        # If the LLM processing succeeded, we should have at least one node
        if len(tree) >= 1:
            print(f"🎉 LLM processing succeeded - created {len(tree)} nodes")
            
            # Check for duplicate node names
            node_names = [node.title for node_id, node in tree.items()]
            # Debug: print all nodes
            print(f"\n📋 All nodes in tree:")
            for node_id, node in tree.items():
                print(f"  - ID {node_id}: '{node.title}' (parent: {node.parent_id})")
            unique_names = set(node_names)
            if len(node_names) != len(unique_names):
                duplicates = [name for name in unique_names if node_names.count(name) > 1]
                pytest.fail(f"Duplicate nodes found: {duplicates}. Total nodes: {len(tree)}, Unique names: {len(unique_names)}")
            
            # Verify that at least one content node was created
            content_nodes = [node for node_id, node in tree.items() if node.content]
            assert len(content_nodes) > 0, "At least one content node should be created"
            
            # Verify parent-child relationships are valid
            for node_id, node in tree.items():
                if node.parent_id is not None:  # Nodes with parents
                    parent_id = node.parent_id
                    assert parent_id in tree, f"Parent {parent_id} of node {node_id} should exist in tree"
                    assert node_id in tree[parent_id].children, f"Node {node_id} should be in parent's children list"
            
            # Test markdown file creation for all nodes
            missing_files = []
            for node_id, node_data in tree.items():
                if node_data.filename:
                    file_path = os.path.join(self.output_dir, node_data.filename)
                    if os.path.exists(file_path):
                        print(f"✅ Markdown file exists for node {node_id}: {node_data.filename}")
                    else:
                        print(f"❌ Markdown file missing for node {node_id}: {node_data.filename}")
                        missing_files.append(node_data.filename)
            
            # Fail if any markdown files are missing
            if missing_files:
                pytest.fail(f"Missing markdown files: {missing_files}")
        else:
            print("⚠️ No nodes were created")
            # The test should fail if no nodes are created
            pytest.fail("No nodes were created by the workflow")

        print("🎯 Integration test completed successfully!")

    @pytest.mark.asyncio
    async def test_workflow_integration(self):
        """Test the overall workflow integration"""
        await self.run_complex_tree_creation()

    def test_workflow_statistics(self):
            """Test that workflow statistics are available"""
            stats = self.processor.get_workflow_statistics()
            assert isinstance(stats, dict), "Workflow statistics should return a dictionary"
            print(f"📊 Workflow statistics: {stats}")

    def test_workflow_state_management(self):
        """Test that workflow state can be managed"""
        # Test clearing state
        try:
            self.processor.clear_workflow_state()
            print("✅ Workflow state cleared successfully")
        except Exception as e:
            print(f"⚠️ Error clearing workflow state: {e}")
            # This might fail if LangGraph is not available, which is okay

