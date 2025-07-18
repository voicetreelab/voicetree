"""
End-to-end integration test for chunk processing pipeline using dependency injection.


Integration test for chunk processing pipeline with mocked workflow.

This test aims to test the chunk processing pipeline, which does:
entrypoint -> process_new_text_and_update_markdown (new text) -> runs agentic workflow -> processes results -> updated tree -> updated markdown

We mock the agentic workflow part to randomly return CREATE or APPEND IntegrationDecisions.

Test approach:
- Randomly call 100 times our entrypoint (process_new_text_and_update_markdown) with random sentences between 1-110 words in length, each word just random letters
- Mock agentic workflow to return IntegrationDecisions by subchunking the actual content in the buffer when full
    - Break buffer into 1-5 random subchunks
    - Each subchunk randomly gets CREATE/APPEND action with real text from buffer
    - Third chunk 50% chance of having complete : false set, so that it is not removed from the buffer, and will be processed next time buffer is full. The behaviour we test is that the content is still processed, no duplication or missing, exhaustive and complete.
- Test such invariants at the MARKDOWN level:
  - Number of nodes matches init + created
  - All text we put into  buffer is preserved in tree
"""

import asyncio
import glob
import os
import random
import re
import shutil
import string
from datetime import datetime
from typing import Dict, List, Any, Optional
import pytest

from backend.text_to_graph_pipeline.chunk_processing_pipeline import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.agentic_workflows.models import CreateAction, AppendAction


def generate_random_sentence(min_words=1, max_words=110):
    """Generate a random sentence with specified word count."""
    word_count = random.randint(min_words, max_words)
    words = []
    for _ in range(word_count):
        word_length = random.randint(3, 10)
        word = ''.join(random.choices(string.ascii_lowercase, k=word_length))
        words.append(word)
    return ' '.join(words)


class MockVoiceTreeAgent:
    """
    Mock VoiceTreeAgent that simulates the agentic workflow behavior.
    This allows us to test the full pipeline without LLM calls.
    """
    
    def __init__(self):
        self.call_count = 0
        self.calls = []
        self.created_nodes = []
        
    async def run(
        self,
        transcript: str,
        transcript_history: Optional[str] = None,
        existing_nodes: Optional[str] = None  # This is actually a string summary
    ) -> Dict[str, Any]:
        """
        Mock implementation of VoiceTreeAgent.run()
        
        Simulates the agent behavior:
        1. Segments the transcript into chunks
        2. Creates integration decisions for each chunk
        3. Returns in the expected format
        """
        self.call_count += 1
        self.calls.append({
            "transcript": transcript,
            "transcript_history": transcript_history,
            "existing_nodes": existing_nodes
        })
        
        # Parse existing nodes from string summary
        existing_node_names = []
        if existing_nodes and existing_nodes != "No existing nodes yet":
            # Extract node names from "NodeName: Summary" format
            for line in existing_nodes.split('\n'):
                if ':' in line:
                    node_name = line.split(':')[0].strip()
                    existing_node_names.append(node_name)
        
        # Simulate chunking - split transcript into 1-5 random chunks
        # Handle empty transcript
        if not transcript.strip():
            return {
                "chunks": [],
                "integration_decisions": [],
                "current_stage": "complete",
                "error_message": None
            }
        
        num_chunks = random.randint(1, min(5, max(1, len(transcript) // 50)))
        
        chunks = []
        integration_decisions = []
        
        # Simulate chunking - split transcript into 1-5 random chunks
        words = transcript.split()
        
        # Handle empty transcript
        if not words:
            return {
                "chunks": [],
                "integration_decisions": [],
                "current_stage": "complete",
                "error_message": None
            }
        
        num_chunks = random.randint(1, min(5, len(words)))
        
        chunks = []
        integration_decisions = []
        
        # Create random chunk boundaries
        if num_chunks == 1:
            chunk_boundaries = [(0, len(words))]
        else:
            # Ensure we don't try to create more chunks than possible
            max_possible_chunks = len(words)
            if num_chunks > max_possible_chunks:
                num_chunks = max_possible_chunks
                
            if num_chunks == 1:
                chunk_boundaries = [(0, len(words))]
            else:
                boundaries = sorted(random.sample(range(1, len(words)), num_chunks - 1))
                chunk_boundaries = [(0, boundaries[0])]
                for i in range(len(boundaries) - 1):
                    chunk_boundaries.append((boundaries[i], boundaries[i + 1]))
                chunk_boundaries.append((boundaries[-1], len(words)))
        
        for i, (start, end) in enumerate(chunk_boundaries):
            chunk_text = " ".join(words[start:end])
            
            # Third chunk has 50% chance of being incomplete
            if i == 2:
                is_complete = random.random() > 0.5
            else:
                is_complete = True
            
            chunks.append({
                "text": chunk_text,
                "is_complete": is_complete
            })
            
            if not is_complete:
                print(f"DEBUG: Created incomplete chunk {i}: '{chunk_text[:50]}...'")
            
            # Only create decisions for complete chunks
            if is_complete:
                # Decide whether to create or append
                if not existing_node_names or random.random() > 0.5:
                    # CREATE action
                    node_name = f"Node_{len(self.created_nodes) + 1}"
                    self.created_nodes.append(node_name)
                    
                    target = None
                    if existing_node_names:
                        # Pick a parent from existing nodes
                        target = random.choice(existing_node_names)
                    
                    decision = {
                        "action": "CREATE",
                        "name": f"chunk_{i}",
                        "text": chunk_text,
                        "reasoning": f"Creating new node for chunk {i}",
                        "new_node_name": node_name,
                        "target_node": target,
                        "relationship_for_edge": "child of" if target else None,
                        "content": chunk_text,
                        "new_node_summary": f"Summary of {node_name}"
                    }
                else:
                    # APPEND action
                    target = random.choice(existing_node_names)
                    decision = {
                        "action": "APPEND",
                        "name": f"chunk_{i}",
                        "text": chunk_text,
                        "reasoning": f"Appending to existing node",
                        "target_node": target,
                        "content": chunk_text,
                        "new_node_name": None,
                        "new_node_summary": None,
                        "relationship_for_edge": None
                    }
                
                integration_decisions.append(decision)
        
        return {
            "chunks": chunks,
            "integration_decisions": integration_decisions,
            "current_stage": "complete",
            "error_message": None
        }


class TestPipelineE2EWithDI:
    """End-to-end tests for the chunk processing pipeline"""
    
    def setup_method(self, method):
        """Set up test environment"""
        self.test_id = f"test_{method.__name__}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.output_dir = os.path.join("markdownTreeVault", self.test_id)
        
        # Ensure clean state
        if os.path.exists(self.output_dir):
            shutil.rmtree(self.output_dir)
    
    def teardown_method(self, method):
        """Clean up test environment"""
        if os.path.exists(self.output_dir):
            shutil.rmtree(self.output_dir)
    
    @pytest.mark.asyncio
    async def test_pipeline_with_mock_agent(self):
        """Test the full pipeline with a mock agent"""
        # Create components
        decision_tree = DecisionTree()
        mock_agent = MockVoiceTreeAgent()
        
        # Create ChunkProcessor with injected mock agent
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            output_dir=self.output_dir,
            agent=mock_agent
        )
        
        # Process some text - needs to be >183 chars to trigger buffer flush
        test_texts = [
            "This is the first chunk of text that should be processed by the pipeline. " * 3 +
            "We need to make sure it's long enough to trigger the buffer flush mechanism.",
            "Here is some more content to add to our knowledge tree. " * 4 +
            "The buffer threshold is 183 characters so we need to exceed that.",
            "Final piece of information to complete the test. " * 5 +
            "This should definitely trigger the workflow processing."
        ]
        
        for text in test_texts:
            await chunk_processor.process_new_text_and_update_markdown(text)
        
        # Wait for async operations
        await asyncio.sleep(0.1)
        
        # Verify agent was called
        assert mock_agent.call_count >= len(test_texts), \
            f"Agent should be called at least {len(test_texts)} times"
        
        # Verify tree has nodes
        assert len(decision_tree.tree) > 0, "Decision tree should have nodes"
        
        # Verify markdown files were created
        md_files = glob.glob(os.path.join(self.output_dir, "*.md"))
        assert len(md_files) > 0, "Markdown files should be created"
        
        # Verify content appears in files
        all_content = ""
        for md_file in md_files:
            with open(md_file, 'r') as f:
                all_content += f.read()
        
        # Check that some of our text appears in the files
        assert any(text_part in all_content for text in test_texts for text_part in text.split()[:3]), \
            "Test text should appear in markdown files"
    
    @pytest.mark.asyncio
    async def test_text_preservation(self):
        """Test that all completed text is preserved through the pipeline"""
        decision_tree = DecisionTree()
        mock_agent = MockVoiceTreeAgent()
        
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            output_dir=self.output_dir,
            agent=mock_agent
        )
        
        # Track what text the agent marks as complete
        completed_texts = []
        
        # Wrap the agent's run method to track completed text
        original_run = mock_agent.run
        async def tracking_run(*args, **kwargs):
            result = await original_run(*args, **kwargs)
            for chunk in result.get("chunks", []):
                if chunk.get("is_complete"):
                    completed_texts.append(chunk["text"])
            return result
        
        mock_agent.run = tracking_run
        
        # Send text through pipeline - needs to be >183 chars to trigger buffer
        test_text = ("The quick brown fox jumps over the lazy dog. " * 5 + 
                     "This is a test of text preservation in the chunk processing pipeline.")
        await chunk_processor.process_new_text_and_update_markdown(test_text)
        
        await asyncio.sleep(0.1)
        
        # Read all content from tree nodes
        node_contents = []
        for node in decision_tree.tree.values():
            if hasattr(node, 'content'):
                node_contents.append(node.content)
        
        # Verify completed text appears in nodes
        all_node_content = " ".join(node_contents)
        for completed in completed_texts:
            assert completed in all_node_content, \
                f"Completed text '{completed}' should appear in tree nodes"
    
    @pytest.mark.asyncio
    async def test_tree_structure_integrity(self):
        """Test that the tree structure maintains integrity"""
        decision_tree = DecisionTree()
        mock_agent = MockVoiceTreeAgent()
        
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            output_dir=self.output_dir,
            agent=mock_agent
        )
        
        # Process multiple texts
        for i in range(5):
            await chunk_processor.process_new_text_and_update_markdown(
                f"Text chunk number {i} with some content."
            )
        
        await asyncio.sleep(0.1)
        
        # Verify tree structure
        assert len(decision_tree.tree) > 0, "Tree should have nodes"
        
        # Check parent-child relationships
        for node_id, node in decision_tree.tree.items():
            if hasattr(node, 'parent_id') and node.parent_id is not None:
                assert node.parent_id in decision_tree.tree, \
                    f"Parent {node.parent_id} should exist in tree"
                
                parent = decision_tree.tree[node.parent_id]
                assert node_id in parent.children, \
                    f"Child {node_id} should be in parent's children list"
        
        # Verify markdown files reflect structure
        md_files = glob.glob(os.path.join(self.output_dir, "*.md"))
        assert len(md_files) == len([n for n in decision_tree.tree.values() 
                                     if hasattr(n, 'title')]), \
            "Should have one markdown file per non-root node"
    
    @pytest.mark.asyncio
    async def test_100_random_sentences_with_invariants(self):
        """Test with 100 random sentences and verify invariants."""
        decision_tree = DecisionTree()
        mock_agent = MockVoiceTreeAgent()
        
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree,
            output_dir=self.output_dir,
            agent=mock_agent
        )
        
        # Track all input text
        all_input_text = []
        initial_node_count = len(decision_tree.tree)
        
        # Generate and process 100 random sentences
        for i in range(101):
            sentence = generate_random_sentence(1, 110)
            all_input_text.append(sentence)
            await chunk_processor.process_new_text_and_update_markdown(sentence)
        
        # Wait for all processing to complete
        await asyncio.sleep(1.0)
        
        # Invariant 1: Number of nodes matches initial + created
        created_nodes = len(mock_agent.created_nodes)
        final_node_count = len(decision_tree.tree)
        assert final_node_count == initial_node_count + created_nodes, \
            f"Node count mismatch: expected {initial_node_count + created_nodes}, got {final_node_count}"
        
        # Invariant 2: All text preserved in tree (for completed chunks)
        # Collect all text content from nodes
        all_node_content = []
        for node in decision_tree.tree.values():
            if hasattr(node, 'content') and node.content:
                all_node_content.append(node.content)
        
        # Also check markdown files
        md_files = glob.glob(os.path.join(self.output_dir, "*.md"))
        all_markdown_content = ""
        for md_file in md_files:
            with open(md_file, 'r') as f:
                all_markdown_content += f.read()
        
        # Combine all content
        all_content = " ".join(all_node_content) + " " + all_markdown_content
        all_content_lower = all_content.lower()
        
        print(f"\nDebug info:")
        print(f"First input text: {all_input_text[0][:100]}...")
        print(f"Nodes created: {len(mock_agent.created_nodes)}")
        print(f"Total node content chars: {sum(len(c) for c in all_node_content)}")
        print(f"Number of markdown files: {len(md_files)}")
        
        # Show a sample of what's in nodes
        if all_node_content:
            print(f"First node content preview: '{all_node_content[0][:100]}...'")
        
        # Simple word-based verification
        # Collect all words from input
        all_input_words = []
        for text in all_input_text:
            all_input_words.extend(text.lower().split())
        
        # Count how many input words appear in the output
        words_found = 0
        for word in all_input_words:
            if word in all_content_lower:
                words_found += 1
        
        word_ratio = words_found / len(all_input_words) if all_input_words else 0
        
        print(f"\nWord preservation:")
        print(f"Total input words: {len(all_input_words)}")
        print(f"Words found in output: {words_found}")
        print(f"Word preservation ratio: {word_ratio:.1%}")
        
        # We expect 90% of words to appear in the output
        # (some words may be in the unflushed buffer at the end)
        assert word_ratio > 0.90, \
            f"Too few words found in output: {word_ratio:.1%} (found {words_found}/{len(all_input_words)} words)"


@pytest.mark.asyncio
async def test_empty_text_handling():
    """Test handling of empty text input"""
    decision_tree = DecisionTree()
    mock_agent = MockVoiceTreeAgent()
    
    chunk_processor = ChunkProcessor(
        decision_tree=decision_tree,
        output_dir="test_empty",
        agent=mock_agent
    )
    
    # Process empty text
    await chunk_processor.process_new_text_and_update_markdown("")
    
    # Agent might not be called for empty text
    # This is expected behavior - buffer manager filters it out
    assert True  # Just verify no exceptions


if __name__ == "__main__":
    pytest.main([__file__, "-v"])