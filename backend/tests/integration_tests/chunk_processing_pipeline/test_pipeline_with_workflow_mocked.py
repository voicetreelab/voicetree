"""
Integration test for chunk processing pipeline with mocked workflow.

This test aims to test the chunk processing pipeline, which does:
entrypoint -> process_new_text_and_update_markdown (new text) -> runs agentic workflow -> processes results -> updated tree -> updated markdown

We mock the agentic workflow part to randomly return CREATE or APPEND IntegrationDecisions.

Test approach:
- Randomly call entrypoint with random sentences between 1-110 words in length
- Mock agentic workflow to return TreeActions for whatever was in the buffer when full
- Break buffer into 1-5 random subchunks
- Each subchunk randomly gets CREATE/APPEND action with real text from buffer
- Test invariants at the MARKDOWN level:
  - Number of nodes matches init + created
  - All text is preserved in tree (length matches expected)
  - Structure/relationships are correct (links match expected)
"""

import asyncio
import random
import re
from typing import List, Dict, Any, Tuple
from unittest.mock import AsyncMock, patch
import pytest

from backend.text_to_graph_pipeline.chunk_processing_pipeline import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowResult
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter


class RandomTextGenerator:
    """Generates random text for testing"""
    
    WORDS = [
        "the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog",
        "artificial", "intelligence", "machine", "learning", "neural", "network",
        "data", "science", "algorithm", "model", "training", "inference",
        "computer", "vision", "natural", "language", "processing", "deep",
        "reinforcement", "supervised", "unsupervised", "gradient", "descent",
        "optimization", "loss", "function", "activation", "backpropagation",
        "transformer", "attention", "mechanism", "embedding", "vector", "space",
        "classification", "regression", "clustering", "dimensionality", "reduction",
        "feature", "engineering", "validation", "testing", "dataset", "batch",
        "epoch", "iteration", "hyperparameter", "tuning", "architecture", "layer",
        "node", "edge", "graph", "tree", "structure", "pattern", "recognition",
        "prediction", "accuracy", "precision", "recall", "metric", "evaluation"
    ]
    
    @staticmethod
    def generate_sentence(min_words: int = 5, max_words: int = 15) -> str:
        """Generate a random sentence with specified word count range"""
        num_words = random.randint(min_words, max_words)
        words = random.choices(RandomTextGenerator.WORDS, k=num_words)
        sentence = " ".join(words)
        return sentence.capitalize() + "."
    
    @staticmethod
    def generate_text(min_words: int = 1, max_words: int = 110) -> str:
        """Generate random text with specified word count range"""
        target_words = random.randint(min_words, max_words)
        sentences = []
        current_words = 0
        
        while current_words < target_words:
            remaining = target_words - current_words
            max_sentence_words = min(15, remaining)
            min_sentence_words = min(5, remaining)
            
            sentence = RandomTextGenerator.generate_sentence(min_sentence_words, max_sentence_words)
            sentences.append(sentence)
            current_words += len(sentence.split())
        
        return " ".join(sentences)


class MockWorkflowGenerator:
    """Generates mock workflow responses"""
    
    @staticmethod
    def split_into_chunks(text: str, num_chunks: int) -> List[str]:
        """Split text into roughly equal chunks"""
        words = text.split()
        if num_chunks >= len(words):
            return [word for word in words]
        
        chunk_size = len(words) // num_chunks
        chunks = []
        
        for i in range(num_chunks):
            start = i * chunk_size
            if i == num_chunks - 1:
                # Last chunk gets remaining words
                chunk_words = words[start:]
            else:
                end = start + chunk_size
                chunk_words = words[start:end]
            
            chunks.append(" ".join(chunk_words))
        
        return chunks
    
    @staticmethod
    def generate_mock_decisions(buffer_text: str, existing_nodes: List[str]) -> WorkflowResult:
        """Generate mock integration decisions for the buffer text"""
        # Randomly decide to split buffer into 1-5 chunks
        num_chunks = random.randint(1, 5)
        chunks = MockWorkflowGenerator.split_into_chunks(buffer_text, num_chunks)
        
        integration_decisions = []
        new_nodes = []
        
        for i, chunk_text in enumerate(chunks):
            # Randomly decide CREATE or APPEND
            action = random.choice(["CREATE", "APPEND"])
            
            decision_dict = {
                "name": f"chunk_{i}",
                "text": chunk_text,
                "reasoning": f"Mock reasoning for chunk {i}",
                "action": action
            }
            
            if action == "CREATE":
                node_name = f"Node_{random.randint(1000, 9999)}"
                new_nodes.append(node_name)
                
                # Pick random parent from existing nodes
                if existing_nodes:
                    parent = random.choice(existing_nodes)
                else:
                    parent = "Root"
                
                decision_dict.update({
                    "new_node_name": node_name,
                    "target_node": parent,
                    "relationship_for_edge": "child of",
                    "content": chunk_text,
                    "new_node_summary": f"Summary for {node_name}"
                })
            else:  # APPEND
                if existing_nodes:
                    target = random.choice(existing_nodes)
                    decision_dict.update({
                        "target_node": target,
                        "content": chunk_text,
                        "new_node_name": None,
                        "new_node_summary": None,
                        "relationship_for_edge": None
                    })
                else:
                    # If no nodes exist, create instead
                    action = "CREATE"
                    node_name = f"Node_{random.randint(1000, 9999)}"
                    new_nodes.append(node_name)
                    decision_dict.update({
                        "action": "CREATE",
                        "new_node_name": node_name,
                        "target_node": "Root",
                        "relationship_for_edge": "child of",
                        "content": chunk_text,
                        "new_node_summary": f"Summary for {node_name}"
                    })
            
            integration_decisions.append(IntegrationDecision(**decision_dict))
        
        return WorkflowResult(
            success=True,
            new_nodes=new_nodes,
            integration_decisions=integration_decisions,
            metadata={
                "chunks_processed": len(chunks),
                "completed_text": buffer_text  # All text is completed
            }
        )


class MarkdownInvariantChecker:
    """Checks invariants on the generated markdown"""
    
    @staticmethod
    def count_nodes(markdown: str) -> int:
        """Count the number of nodes in the markdown"""
        # Count headers (nodes are represented as headers)
        node_pattern = r'^#{1,6}\s+.+$'
        nodes = re.findall(node_pattern, markdown, re.MULTILINE)
        return len(nodes)
    
    @staticmethod
    def extract_all_text(markdown: str) -> str:
        """Extract all content text from the markdown"""
        # Remove headers and links, keep only content
        lines = markdown.split('\n')
        content_lines = []
        
        for line in lines:
            # Skip headers
            if line.strip().startswith('#'):
                continue
            # Skip link-only lines
            if line.strip().startswith('[[') and line.strip().endswith(']]'):
                continue
            # Skip empty lines
            if not line.strip():
                continue
            
            content_lines.append(line.strip())
        
        return ' '.join(content_lines)
    
    @staticmethod
    def count_relationships(markdown: str) -> int:
        """Count the number of relationships (links) in the markdown"""
        # Count wiki-style links
        link_pattern = r'\[\[([^\]]+)\]\]'
        links = re.findall(link_pattern, markdown)
        return len(links)


@pytest.mark.asyncio
class TestPipelineWithMockedWorkflow:
    """Test the chunk processing pipeline with mocked workflow"""
    
    async def test_random_invariants(self):
        """Test pipeline with random inputs and check invariants"""
        # Initialize components
        decision_tree = DecisionTree()
        chunk_processor = ChunkProcessor(
            decision_tree=decision_tree
        )
        
        # Track state for invariant checking
        initial_node_count = len(decision_tree.tree)
        total_text_added = ""
        total_creates = 0
        
        # Store existing node names for mock
        def get_existing_node_names():
            return [node.name for node in decision_tree.tree.values() if hasattr(node, 'name')]
        
        # Run multiple iterations
        num_iterations = 10
        
        for iteration in range(num_iterations):
            # Generate random text
            text = RandomTextGenerator.generate_text(1, 110)
            total_text_added += text + " "  # Space for separation
            
            # Mock the workflow adapter
            with patch.object(
                chunk_processor.workflow_adapter, 
                'process_full_buffer',
                new_callable=AsyncMock
            ) as mock_process:
                # Set up mock to generate decisions based on buffer content
                def mock_workflow_side_effect(transcript, context=None):
                    existing = get_existing_node_names()
                    return MockWorkflowGenerator.generate_mock_decisions(transcript, existing)
                
                mock_process.side_effect = mock_workflow_side_effect
                
                # Process the text
                markdown = await chunk_processor.process_new_text_and_update_markdown(text)
                
                # Count creates from mock calls
                if mock_process.called:
                    for call in mock_process.call_args_list:
                        result = mock_workflow_side_effect(call[1]['transcript'])
                        total_creates += len(result.new_nodes)
        
        # Get final markdown by reading from files
        # For testing purposes, we'll use a simpler approach - convert tree to markdown representation
        final_markdown = self._tree_to_markdown_string(decision_tree)
        
        # Check invariants
        # 1. Node count invariant
        final_node_count = MarkdownInvariantChecker.count_nodes(final_markdown)
        expected_node_count = initial_node_count + total_creates
        assert final_node_count == expected_node_count, \
            f"Node count mismatch: expected {expected_node_count}, got {final_node_count}"
        
        # 2. Text preservation invariant
        markdown_text = MarkdownInvariantChecker.extract_all_text(final_markdown)
        # Clean up the text for comparison (remove extra spaces)
        total_text_added = ' '.join(total_text_added.split())
        
        # All added text should be in the markdown
        for word in total_text_added.split():
            assert word in markdown_text, f"Word '{word}' not found in markdown"
        
        # 3. Structure invariant - relationships
        relationship_count = MarkdownInvariantChecker.count_relationships(final_markdown)
        # Each non-root node should have at least one relationship (to parent)
        min_expected_relationships = total_creates  # Each created node has parent
        assert relationship_count >= min_expected_relationships, \
            f"Relationship count too low: expected at least {min_expected_relationships}, got {relationship_count}"
    
    async def test_empty_tree_handling(self):
        """Test that pipeline handles empty tree correctly"""
        decision_tree = DecisionTree()
        chunk_processor = ChunkProcessor(decision_tree=decision_tree)
        
        with patch.object(
            chunk_processor.workflow_adapter,
            'process_full_buffer',
            new_callable=AsyncMock
        ) as mock_process:
            # Mock should create root node when tree is empty
            mock_process.return_value = WorkflowResult(
                success=True,
                new_nodes=["Root"],
                integration_decisions=[
                    IntegrationDecision(
                        action="CREATE",
                        name="chunk_0",
                        text="Initial text",
                        reasoning="Creating root",
                        new_node_name="Root",
                        target_node=None,
                        relationship_for_edge=None,
                        content="Initial text",
                        new_node_summary="Root node"
                    )
                ],
                metadata={"completed_text": "Initial text"}
            )
            
            markdown = await chunk_processor.process_new_text_and_update_markdown("Initial text")
            assert "Root" in markdown
            assert "Initial text" in markdown
    
    async def test_large_text_handling(self):
        """Test handling of large text that triggers multiple buffer flushes"""
        decision_tree = DecisionTree()
        chunk_processor = ChunkProcessor(decision_tree=decision_tree)
        
        # Generate large text (multiple buffer sizes)
        large_text = RandomTextGenerator.generate_text(500, 1000)
        words_processed = []
        
        with patch.object(
            chunk_processor.workflow_adapter,
            'process_full_buffer',
            new_callable=AsyncMock
        ) as mock_process:
            def track_processed_text(transcript, context=None):
                words_processed.extend(transcript.split())
                existing = [node.name for node in decision_tree.tree.values() if hasattr(node, 'name')]
                return MockWorkflowGenerator.generate_mock_decisions(transcript, existing)
            
            mock_process.side_effect = track_processed_text
            
            await chunk_processor.process_new_text_and_update_markdown(large_text)
            
            # Verify all text was eventually processed
            large_text_words = set(large_text.split())
            processed_words = set(words_processed)
            
            # Most words should be processed (some might remain in buffer)
            assert len(processed_words.intersection(large_text_words)) > len(large_text_words) * 0.8


if __name__ == "__main__":
    pytest.main([__file__, "-v"])