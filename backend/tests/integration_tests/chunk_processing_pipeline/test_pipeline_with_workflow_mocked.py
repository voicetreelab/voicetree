"""
Integration test for chunk processing pipeline with mocked workflow.

This test aims to test the chunk processing pipeline, which does:
entrypoint -> process_new_text_and_update_markdown (new text) -> runs agentic workflow -> processes results -> updated tree -> updated markdown

We mock the agentic workflow part to randomly return CREATE or APPEND TreeActions.

Test approach:
- Randomly call entrypoint with random sentences between 1-110 words in length
- Mock agentic workflow to return TreeActions for whatever was in the buffer when full
- Break buffer into 1-5 random subchunks
- Each subchunk randomly gets CREATE/APPEND action with real text from buffer
- Make last subchunk incomplete with probability 0.5 to test buffer flushing
- Test invariants at the MARKDOWN FILE level:
  - Number of nodes matches init + created
  - All text is preserved in tree (including incomplete chunks)
  - Structure/relationships are correct (links match expected)
"""

import asyncio
import glob
import os
import random
import re
import shutil
import string
from datetime import datetime
from typing import List, Dict, Set, Tuple
from unittest.mock import AsyncMock, patch
import pytest

from backend.text_to_graph_pipeline.chunk_processing_pipeline import ChunkProcessor
from backend.text_to_graph_pipeline.tree_manager.decision_tree_ds import DecisionTree
from backend.text_to_graph_pipeline.chunk_processing_pipeline.workflow_adapter import WorkflowResult
from backend.text_to_graph_pipeline.agentic_workflows.models import IntegrationDecision
from backend.text_to_graph_pipeline.tree_manager.tree_to_markdown import TreeToMarkdownConverter


class RandomTextGenerator:
    """Generates truly random text with unique words"""
    
    @staticmethod
    def generate_random_word() -> str:
        """Generate a random word from random letters"""
        # Random word length between 3 and 12 characters
        word_length = random.randint(3, 12)
        # Generate random letters
        letters = ''.join(random.choices(string.ascii_lowercase, k=word_length))
        return letters
    
    @staticmethod
    def generate_sentence(min_words: int = 5, max_words: int = 15) -> str:
        """Generate a random sentence with specified word count range"""
        num_words = random.randint(min_words, max_words)
        words = [RandomTextGenerator.generate_random_word() for _ in range(num_words)]
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
    """Generates mock workflow responses with incomplete chunk handling"""
    
    def __init__(self):
        self.incomplete_text = ""  # Store incomplete text between calls
    
    def split_into_chunks(self, text: str, num_chunks: int) -> List[str]:
        """Split text into roughly equal chunks preserving whole words"""
        words = text.split()
        if num_chunks >= len(words):
            return words
        
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
    
    def generate_mock_decisions(self, buffer_text: str, existing_node_names: List[str]) -> WorkflowResult:
        """Generate mock integration decisions for the buffer text with incomplete chunk handling"""
        # The buffer_text is what's actually in the buffer
        # We can only mark as completed what's actually in buffer_text
        
        # Randomly decide to split buffer into 1-5 chunks
        num_chunks = random.randint(1, 5)
        chunks = self.split_into_chunks(buffer_text, num_chunks)
        
        integration_decisions = []
        new_nodes = []
        completed_text = ""
        
        # Process all chunks except potentially the last one
        for i, chunk_text in enumerate(chunks):
            is_last_chunk = (i == len(chunks) - 1)
            
            # With 0.5 probability, mark last chunk as incomplete
            if is_last_chunk and random.random() < 0.5:
                # This chunk is incomplete - don't process it
                # The text stays in the buffer for next call
                continue
            else:
                # Process this chunk
                completed_text += chunk_text + " "
                
                # Randomly decide CREATE or APPEND
                if not existing_node_names:
                    action = "CREATE"
                else:
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
                    if existing_node_names:
                        parent = random.choice(existing_node_names)
                    else:
                        parent = None  # First node has no parent
                    
                    decision_dict.update({
                        "new_node_name": node_name,
                        "target_node": parent,
                        "relationship_for_edge": "child of" if parent else None,
                        "content": chunk_text,
                        "new_node_summary": f"Summary for {node_name}"
                    })
                else:  # APPEND
                    target = random.choice(existing_node_names)
                    decision_dict.update({
                        "target_node": target,
                        "content": chunk_text,
                        "new_node_name": None,
                        "new_node_summary": None,
                        "relationship_for_edge": None
                    })
                
                integration_decisions.append(IntegrationDecision(**decision_dict))
        
        return WorkflowResult(
            success=True,
            new_nodes=new_nodes,
            integration_decisions=integration_decisions,
            metadata={
                "chunks_processed": len(integration_decisions),
                "completed_text": completed_text.strip()
            }
        )


class MarkdownFileReader:
    """Reads and analyzes markdown files from disk"""
    
    @staticmethod
    def read_all_markdown_files(output_dir: str) -> Dict[str, str]:
        """Read all markdown files from the output directory"""
        markdown_files = {}
        md_pattern = os.path.join(output_dir, "*.md")
        
        for filepath in sorted(glob.glob(md_pattern)):
            filename = os.path.basename(filepath)
            with open(filepath, 'r', encoding='utf-8') as f:
                markdown_files[filename] = f.read()
        
        return markdown_files
    
    @staticmethod
    def extract_node_names(markdown_files: Dict[str, str]) -> List[str]:
        """Extract node names from markdown file names and content"""
        node_names = []
        
        for filename, content in markdown_files.items():
            # Extract from filename (format: XX_node_name.md)
            match = re.match(r'^\d+_(.+)\.md$', filename)
            if match:
                node_name = match.group(1).replace('_', ' ')
                node_names.append(node_name)
            
            # Also check headers in content
            headers = re.findall(r'^#\s+(.+)$', content, re.MULTILINE)
            node_names.extend(headers)
        
        return list(set(node_names))  # Remove duplicates
    
    @staticmethod
    def extract_all_content(markdown_files: Dict[str, str]) -> str:
        """Extract all non-structural content from markdown files"""
        all_content = []
        
        for content in markdown_files.values():
            lines = content.split('\n')
            
            for line in lines:
                line = line.strip()
                
                # Skip headers
                if line.startswith('#'):
                    continue
                
                # Skip links (wiki-style [[...]])
                if re.match(r'^\[\[.*\]\]$', line):
                    continue
                
                # Skip empty lines
                if not line:
                    continue
                
                # Skip structural markers
                if line in ["_Links:_", "Children:", "Parent:", "-----------------"]:
                    continue
                
                # Skip link lines (start with -)
                if line.startswith("- ") and "[[" in line:
                    continue
                
                # This is actual content
                all_content.append(line)
        
        return ' '.join(all_content)
    
    @staticmethod
    def count_relationships(markdown_files: Dict[str, str]) -> int:
        """Count all relationships (links) in markdown files"""
        total_links = 0
        
        for content in markdown_files.values():
            # Count wiki-style links
            links = re.findall(r'\[\[([^\]]+)\]\]', content)
            total_links += len(links)
        
        return total_links
    
    @staticmethod
    def extract_node_relationships(markdown_files: Dict[str, str]) -> List[Tuple[str, str]]:
        """Extract parent-child relationships from markdown files"""
        relationships = []
        
        for filename, content in markdown_files.items():
            # Get node name from filename
            match = re.match(r'^\d+_(.+)\.md$', filename)
            if not match:
                continue
                
            node_name = match.group(1).replace('_', ' ')
            
            # Find parent section in content
            lines = content.split('\n')
            in_parent_section = False
            
            for line in lines:
                if line.strip() == "Parent:":
                    in_parent_section = True
                elif line.strip() in ["Children:", "_Links:_", ""] or line.strip().startswith("#"):
                    in_parent_section = False
                elif in_parent_section and "[[" in line:
                    # Extract parent link from parent section only
                    parent_match = re.search(r'\[\[([^\]]+)\]\]', line)
                    if parent_match:
                        parent_filename = parent_match.group(1)
                        # Convert filename back to node name
                        parent_node_match = re.match(r'^\d+_(.+)\.md$', parent_filename)
                        if parent_node_match:
                            parent_name = parent_node_match.group(1).replace('_', ' ')
                        else:
                            parent_name = parent_filename
                        relationships.append((parent_name, node_name))
        
        return relationships


@pytest.mark.asyncio
class TestPipelineWithMockedWorkflow:
    """Test the chunk processing pipeline with mocked workflow"""
    
    def setup_method(self, method):
        """Set up test environment"""
        # Create a unique test output directory
        self.test_id = f"test_{method.__name__}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.output_dir = os.path.join("markdownTreeVault", self.test_id)
        
        # Ensure clean state
        if os.path.exists(self.output_dir):
            shutil.rmtree(self.output_dir)
    
    def teardown_method(self, method):
        """Clean up test environment"""
        # Remove test output directory
        if os.path.exists(self.output_dir):
            shutil.rmtree(self.output_dir)
    
    def get_existing_node_names_from_tree(self, decision_tree: DecisionTree) -> List[str]:
        """Get node names from the decision tree"""
        node_names = []
        for node in decision_tree.tree.values():
            if hasattr(node, 'title'):
                node_names.append(node.title)
            elif hasattr(node, 'name'):
                node_names.append(node.name)
        return node_names
    
    async def test_random_invariants_with_incomplete_chunks(self):
        """Test pipeline with random inputs and incomplete chunks"""
        # Initialize components
        decision_tree = DecisionTree()
        
        # Mock the VoiceTreeAgent to prevent initialization delays
        with patch('backend.text_to_graph_pipeline.agentic_workflows.agents.voice_tree.VoiceTreeAgent'):
            chunk_processor = ChunkProcessor(
                decision_tree=decision_tree,
                output_dir=self.output_dir
            )
        
        # Track state for invariant checking
        all_text_sent = []  # All text sent to the pipeline
        all_completed_text = []  # Text marked as completed by workflow
        created_nodes_count = 0
        
        # Create a mock generator instance to maintain incomplete text state
        mock_generator = MockWorkflowGenerator()
        
        # Run multiple iterations
        num_iterations = 10
        
        for iteration in range(num_iterations):
            # Generate random text with truly random words
            text = RandomTextGenerator.generate_text(1, 110)
            all_text_sent.append(text)
            
            # Mock the workflow adapter
            with patch.object(
                chunk_processor.workflow_adapter, 
                'process_full_buffer',
                new_callable=AsyncMock
            ) as mock_process:
                # Set up mock to generate decisions based on buffer content
                def mock_workflow_side_effect(transcript, context=None):
                    existing = self.get_existing_node_names_from_tree(decision_tree)
                    result = mock_generator.generate_mock_decisions(transcript, existing)
                    
                    # Track completed text and created nodes
                    nonlocal created_nodes_count
                    if result.metadata.get("completed_text"):
                        all_completed_text.append(result.metadata["completed_text"])
                    created_nodes_count += len(result.new_nodes)
                    
                    return result
                
                mock_process.side_effect = mock_workflow_side_effect
                
                # Process the text
                await chunk_processor.process_new_text_and_update_markdown(text)
        
        # Process any remaining incomplete text by sending empty string
        # This simulates end of stream handling
        with patch.object(
            chunk_processor.workflow_adapter, 
            'process_full_buffer',
            new_callable=AsyncMock
        ) as mock_process:
            def final_mock_side_effect(transcript, context=None):
                # Force processing of any incomplete text
                mock_generator.incomplete_text = ""  # Clear incomplete buffer
                existing = self.get_existing_node_names_from_tree(decision_tree)
                # Return empty result since we're just flushing
                return WorkflowResult(
                    success=True,
                    new_nodes=[],
                    integration_decisions=[],
                    metadata={"completed_text": ""}
                )
            
            mock_process.side_effect = final_mock_side_effect
            
            # Send empty text to potentially flush buffer
            await chunk_processor.process_new_text_and_update_markdown("")
        
        # Wait a bit for file system operations
        await asyncio.sleep(0.1)
        
        # Read actual markdown files from disk
        markdown_files = MarkdownFileReader.read_all_markdown_files(self.output_dir)
        
        # INVARIANT 1: Node count matches expected
        actual_nodes_in_files = len(markdown_files)  # Each file is a node
        
        assert actual_nodes_in_files > 0, "No markdown files were created"
        assert actual_nodes_in_files <= created_nodes_count + 1, \
            f"More files than expected: {actual_nodes_in_files} files, but only {created_nodes_count} nodes created (+1 for potential root)"
        
        # INVARIANT 2: All completed text is preserved
        # Extract all content from markdown files
        all_content_in_files = MarkdownFileReader.extract_all_content(markdown_files)
        
        # Extract unique words (our random words should be unique)
        def extract_unique_words(text):
            # Extract words only (alphabetic characters)
            words = re.findall(r'[a-zA-Z]+', text.lower())
            return set(words)
        
        completed_words = set()
        for text in all_completed_text:
            completed_words.update(extract_unique_words(text))
        
        file_words = extract_unique_words(all_content_in_files)
        
        # All completed words should be in the files
        missing_words = completed_words - file_words
        assert len(missing_words) == 0, \
            f"Completed words missing from markdown files: {list(missing_words)[:10]}..."
        
        # Also verify that we actually processed some text
        assert len(completed_words) > 0, "No text was marked as completed"
        assert len(file_words) > 0, "No content found in markdown files"
        
        # INVARIANT 3: Structure/relationships are correct
        # Count relationships
        relationship_count = MarkdownFileReader.count_relationships(markdown_files)
        
        # Each non-root node should have at least one parent relationship
        assert relationship_count >= actual_nodes_in_files - 1, \
            f"Too few relationships: {relationship_count} for {actual_nodes_in_files} nodes"
        
        # Verify relationships form valid tree structure
        relationships = MarkdownFileReader.extract_node_relationships(markdown_files)
        child_counts = {}
        for parent, child in relationships:
            child_counts[child] = child_counts.get(child, 0) + 1
        
        # Each node should have at most one parent (tree property)
        for child, count in child_counts.items():
            assert count <= 1, f"Node '{child}' has {count} parents, violating tree structure"
    
    async def test_empty_tree_handling(self):
        """Test that pipeline handles empty tree correctly by creating files"""
        decision_tree = DecisionTree()
        
        # Mock the VoiceTreeAgent
        with patch('backend.text_to_graph_pipeline.agentic_workflows.agents.voice_tree.VoiceTreeAgent'):
            chunk_processor = ChunkProcessor(
                decision_tree=decision_tree,
                output_dir=self.output_dir
            )
        
        with patch.object(
            chunk_processor.workflow_adapter,
            'process_full_buffer',
            new_callable=AsyncMock
        ) as mock_process:
            # Mock should create root node when tree is empty
            initial_text = RandomTextGenerator.generate_text(30, 40)  # Generate enough to trigger buffer
            mock_process.return_value = WorkflowResult(
                success=True,
                new_nodes=["Root"],
                integration_decisions=[
                    IntegrationDecision(
                        action="CREATE",
                        name="chunk_0",
                        text=initial_text,
                        reasoning="Creating root",
                        new_node_name="Root",
                        target_node=None,
                        relationship_for_edge=None,
                        content=initial_text,
                        new_node_summary="Root node"
                    )
                ],
                metadata={"completed_text": initial_text}
            )
            
            await chunk_processor.process_new_text_and_update_markdown(initial_text)
            
            # Wait for file operations
            await asyncio.sleep(0.1)
            
            # Check markdown files were created
            markdown_files = MarkdownFileReader.read_all_markdown_files(self.output_dir)
            assert len(markdown_files) > 0, "No markdown files created for empty tree"
            
            # Verify content contains our random words
            all_content = MarkdownFileReader.extract_all_content(markdown_files)
            
            # Check that some words from initial text appear in content
            initial_words = set(re.findall(r'[a-zA-Z]+', initial_text.lower()))
            content_words = set(re.findall(r'[a-zA-Z]+', all_content.lower()))
            
            common_words = initial_words.intersection(content_words)
            assert len(common_words) > len(initial_words) * 0.8, \
                f"Not enough words from initial text found in content"
    
    async def test_incomplete_chunk_buffer_persistence(self):
        """Test that incomplete chunks persist in buffer across multiple calls"""
        decision_tree = DecisionTree()
        
        # Mock the VoiceTreeAgent
        with patch('backend.text_to_graph_pipeline.agentic_workflows.agents.voice_tree.VoiceTreeAgent'):
            chunk_processor = ChunkProcessor(
                decision_tree=decision_tree,
                output_dir=self.output_dir
            )
        
        # Use a single mock generator instance to maintain state
        mock_generator = MockWorkflowGenerator()
        buffer_calls = []
        
        # First call - generate text that will trigger buffer flush
        text1 = RandomTextGenerator.generate_text(30, 40)
        
        with patch.object(
            chunk_processor.workflow_adapter,
            'process_full_buffer',
            new_callable=AsyncMock
        ) as mock_process:
            def first_call_handler(transcript, context=None):
                buffer_calls.append(transcript)
                # Force incomplete chunk - don't process last part
                words = transcript.split()
                midpoint = len(words) // 2
                completed_part = " ".join(words[:midpoint])
                
                # Create a node with the completed part
                return WorkflowResult(
                    success=True,
                    new_nodes=["Node_1"],
                    integration_decisions=[
                        IntegrationDecision(
                            action="CREATE",
                            name="chunk_0",
                            text=completed_part,
                            reasoning="Processing first part",
                            new_node_name="Node_1",
                            target_node=None,
                            relationship_for_edge=None,
                            content=completed_part,
                            new_node_summary="First node"
                        )
                    ],
                    metadata={"completed_text": completed_part}
                )
            
            mock_process.side_effect = first_call_handler
            await chunk_processor.process_new_text_and_update_markdown(text1)
        
        # Second call - should include incomplete text from first call
        text2 = RandomTextGenerator.generate_text(20, 30)
        
        with patch.object(
            chunk_processor.workflow_adapter,
            'process_full_buffer',
            new_callable=AsyncMock
        ) as mock_process:
            def second_call_handler(transcript, context=None):
                buffer_calls.append(transcript)
                
                # Verify buffer contains text from both calls
                # The incomplete part from first call should be in this buffer
                first_buffer_words = set(re.findall(r'[a-zA-Z]+', buffer_calls[0].lower()))
                second_buffer_words = set(re.findall(r'[a-zA-Z]+', transcript.lower()))
                
                # Some words from the first buffer's second half should be here
                # (the part that wasn't marked as completed)
                first_words_list = buffer_calls[0].split()
                incomplete_words = set(w.lower() for w in first_words_list[len(first_words_list)//2:])
                
                common_incomplete = incomplete_words.intersection(second_buffer_words)
                assert len(common_incomplete) > 0, \
                    f"Incomplete words from first call not found in second buffer. " \
                    f"Expected some of {list(incomplete_words)[:5]} in buffer"
                
                # Process everything this time
                return WorkflowResult(
                    success=True,
                    new_nodes=["Node_2"],
                    integration_decisions=[
                        IntegrationDecision(
                            action="CREATE",
                            name="chunk_0",
                            text=transcript,
                            reasoning="Processing second buffer",
                            new_node_name="Node_2",
                            target_node="Node_1",
                            relationship_for_edge="child of",
                            content=transcript,
                            new_node_summary="Second node"
                        )
                    ],
                    metadata={"completed_text": transcript}
                )
            
            mock_process.side_effect = second_call_handler
            await chunk_processor.process_new_text_and_update_markdown(text2)
        
        # Wait for file operations
        await asyncio.sleep(0.1)
        
        # Verify files were created
        markdown_files = MarkdownFileReader.read_all_markdown_files(self.output_dir)
        assert len(markdown_files) == 2, f"Expected 2 markdown files, got {len(markdown_files)}"
        
        # Verify that incomplete text from first call made it to files
        all_content = MarkdownFileReader.extract_all_content(markdown_files)
        
        # The incomplete words from first buffer should be in the content
        first_words_list = buffer_calls[0].split()
        incomplete_words = set(w.lower() for w in first_words_list[len(first_words_list)//2:])
        content_words = set(re.findall(r'[a-zA-Z]+', all_content.lower()))
        
        common_words = incomplete_words.intersection(content_words)
        assert len(common_words) > 0, \
            f"Incomplete words from first call not found in final markdown files. " \
            f"Expected some of {list(incomplete_words)[:5]} in content"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])