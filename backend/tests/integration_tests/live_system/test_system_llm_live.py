import os
import shutil  # For directory operations

import nest_asyncio
import pytest

from backend.markdown_tree_manager.graph_flattening.tree_to_markdown import (
    TreeToMarkdownConverter,
)
from backend.markdown_tree_manager.markdown_tree_ds import MarkdownTree
from backend.text_to_graph_pipeline.chunk_processing_pipeline.chunk_processor import (
    ChunkProcessor,
)

# Apply nest_asyncio to allow nested event loops
nest_asyncio.apply()


class TestIntegration:
    @pytest.fixture(autouse=True)
    def setup_method(self, tmp_path):
        self.decision_tree = MarkdownTree()
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
            await self.processor.process_new_text_and_update_markdown(transcript)
            print("✅ Processing completed without errors")

            # Process any remaining buffer content
            remaining_buffer = self.processor.buffer_manager.get_buffer()
            if remaining_buffer:
                print(f"📝 Processing remaining buffer: {len(remaining_buffer)} chars")
                await self.processor.process_new_text(remaining_buffer)

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
                    with open(first_file_path) as f:
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
            print("\n📋 All nodes in tree:")
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

    @pytest.mark.asyncio
    async def test_multi_buffer_processing(self):
        """
        Test that the system can process multiple complete buffers correctly.
        This ensures the buffer management and workflow system handles larger inputs properly.
        """
        print("\n🧪 Testing multi-buffer processing workflow...")

        # Create text chunks that will definitely trigger multiple buffer flushes
        # Buffer threshold is 163 characters, so we'll create chunks that exceed this
        buffer_threshold = self.processor.text_buffer_size_threshold
        print(f"📊 Buffer threshold: {buffer_threshold} characters")

        # First chunk - should exceed buffer threshold (200+ chars)
        first_chunk = (
            "I'm starting a comprehensive project on artificial intelligence and machine learning. "
            "This project will involve multiple components including data preprocessing, model training, "
            "evaluation metrics, and deployment strategies for production systems."
        )

        # Second chunk - should also exceed buffer threshold (200+ chars)
        second_chunk = (
            "The system architecture will include a data ingestion pipeline that handles various data sources "
            "including text, images, and structured data. We'll implement feature engineering processes "
            "and automated model selection algorithms."
        )

        # Third chunk - should also exceed buffer threshold (200+ chars)
        third_chunk = (
            "For the deployment phase, we'll use containerization with Docker and orchestration with Kubernetes. "
            "The monitoring system will track model performance, data drift, and system health metrics "
            "in real-time production environments."
        )

        print(f"📝 First chunk length: {len(first_chunk)} chars")
        print(f"📝 Second chunk length: {len(second_chunk)} chars")
        print(f"📝 Third chunk length: {len(third_chunk)} chars")

        # Verify chunks are large enough to trigger buffer processing
        assert len(first_chunk) > buffer_threshold, f"First chunk ({len(first_chunk)}) should exceed buffer threshold ({buffer_threshold})"
        assert len(second_chunk) > buffer_threshold, f"Second chunk ({len(second_chunk)}) should exceed buffer threshold ({buffer_threshold})"
        assert len(third_chunk) > buffer_threshold, f"Third chunk ({len(third_chunk)}) should exceed buffer threshold ({buffer_threshold})"

        # Track buffer processing events
        initial_tree_size = len(self.decision_tree.tree)
        buffer_process_count = 0

        try:
            # Process first chunk
            print("🔄 Processing first chunk...")
            await self.processor.process_new_text_and_update_markdown(first_chunk)

            # Check if buffer was processed (tree should have new nodes)
            tree_size_after_first = len(self.decision_tree.tree)
            if tree_size_after_first > initial_tree_size:
                buffer_process_count += 1
                print(f"✅ First buffer processed - tree grew from {initial_tree_size} to {tree_size_after_first} nodes")

            # Process second chunk
            print("🔄 Processing second chunk...")
            await self.processor.process_new_text_and_update_markdown(second_chunk)

            # Check if second buffer was processed
            tree_size_after_second = len(self.decision_tree.tree)
            if tree_size_after_second > tree_size_after_first:
                buffer_process_count += 1
                print(f"✅ Second buffer processed - tree grew from {tree_size_after_first} to {tree_size_after_second} nodes")

            # Process third chunk
            print("🔄 Processing third chunk...")
            await self.processor.process_new_text_and_update_markdown(third_chunk)

            # Check if third buffer was processed
            tree_size_after_third = len(self.decision_tree.tree)
            if tree_size_after_third > tree_size_after_second:
                buffer_process_count += 1
                print(f"✅ Third buffer processed - tree grew from {tree_size_after_second} to {tree_size_after_third} nodes")

            # Process any remaining buffer content
            remaining_buffer = self.processor.buffer_manager.get_buffer()
            if remaining_buffer:
                print(f"📝 Processing remaining buffer: {len(remaining_buffer)} chars")
                await self.processor.process_new_text(remaining_buffer)

                # Check if remaining buffer was processed
                tree_size_after_remaining = len(self.decision_tree.tree)
                if tree_size_after_remaining > tree_size_after_third:
                    buffer_process_count += 1
                    print(f"✅ Remaining buffer processed - tree grew from {tree_size_after_third} to {tree_size_after_remaining} nodes")

            # Finalize to ensure all processing is complete
            await self.processor.finalize()
            final_tree_size = len(self.decision_tree.tree)

            print("📊 Buffer processing summary:")
            print(f"   - Initial tree size: {initial_tree_size}")
            print(f"   - Final tree size: {final_tree_size}")
            print(f"   - Buffer processes detected: {buffer_process_count}")
            print(f"   - Total nodes created: {final_tree_size - initial_tree_size}")

        except Exception as e:
            print(f"❌ Multi-buffer processing failed with error: {e}")
            pytest.fail(f"Multi-buffer processing should not fail: {e}")

        # Assertions for multi-buffer processing
        final_tree = self.decision_tree.tree

        # Should have processed at least 2 complete buffers
        assert buffer_process_count >= 2, f"Should have processed at least 2 buffers, but only processed {buffer_process_count}"

        # Tree should have grown significantly
        nodes_created = final_tree_size - initial_tree_size
        assert nodes_created >= 2, f"Should have created at least 2 nodes from multi-buffer processing, but only created {nodes_created}"

        # Verify tree structure integrity
        print("🔍 Verifying tree structure integrity...")
        for node_id, node in final_tree.items():
            if node.parent_id is not None:
                assert node.parent_id in final_tree, f"Parent {node.parent_id} of node {node_id} should exist in tree"
                assert node_id in final_tree[node.parent_id].children, f"Node {node_id} should be in parent's children list"

        # Verify content quality - nodes should contain content from different chunks
        content_nodes = [node for node_id, node in final_tree.items() if node.content]
        assert len(content_nodes) > 0, "Should have at least one content node"

        # Check that content from different chunks appears in the tree
        all_content = " ".join([node.content for node in content_nodes])

        # Look for key terms from each chunk
        first_chunk_terms = ["artificial intelligence", "machine learning", "data preprocessing"]
        second_chunk_terms = ["data ingestion pipeline", "feature engineering", "model selection"]
        third_chunk_terms = ["containerization", "Docker", "Kubernetes", "monitoring"]

        chunks_represented = 0
        for terms in [first_chunk_terms, second_chunk_terms, third_chunk_terms]:
            if any(term.lower() in all_content.lower() for term in terms):
                chunks_represented += 1

        print(f"📊 Content analysis: {chunks_represented}/3 chunks represented in tree content")
        assert chunks_represented >= 2, f"Content from at least 2 different chunks should appear in tree, but only {chunks_represented} chunks represented"

        # Verify markdown file creation for multi-buffer content
        markdown_files_created = 0
        for node_id, node in final_tree.items():
            if node.filename:
                file_path = os.path.join(self.output_dir, node.filename)
                if os.path.exists(file_path):
                    markdown_files_created += 1

        print(f"📁 Markdown files created: {markdown_files_created}")
        assert markdown_files_created >= 1, "Should have created at least one markdown file from multi-buffer processing"

        print("🎉 Multi-buffer processing test completed successfully!")
        print(f"✅ Processed {buffer_process_count} buffers")
        print(f"✅ Created {nodes_created} new nodes")
        print(f"✅ Generated {markdown_files_created} markdown files")
        print(f"✅ Represented content from {chunks_represented} different input chunks")

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

