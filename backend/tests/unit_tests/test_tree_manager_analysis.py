#!/usr/bin/env python3
"""
Day 1 Analysis: ContextualTreeManager API Usage Patterns

This test documents how ContextualTreeManager is actually used across the codebase.
This analysis will inform our interface extraction in Day 2.

Bible Rule Compliance:
- Small, testable unit of work ✅
- Documents current state before evolving ✅  
- Can run `make test-all` to validate ✅
"""

import unittest
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.tree_manager.text_to_tree_manager import ContextualTreeManager
from backend.tree_manager.decision_tree_ds import DecisionTree


class TestContextualTreeManagerAnalysis(unittest.TestCase):
    """
    Day 1 Analysis: Document ContextualTreeManager API usage patterns
    
    This test documents the actual API that ContextualTreeManager exposes
    and how it's used across the codebase. This will inform our interface
    design in Day 2.
    """
    
    def setUp(self):
        """Set up test fixtures"""
        self.decision_tree = DecisionTree()
        self.manager = ContextualTreeManager(decision_tree=self.decision_tree)
    
    def test_constructor_api_pattern(self):
        """Document: How ContextualTreeManager is constructed"""
        # Pattern found in 10+ files: ContextualTreeManager(decision_tree=decision_tree)
        manager = ContextualTreeManager(decision_tree=self.decision_tree)
        
        # Verify expected attributes exist
        self.assertIsNotNone(manager.decision_tree)
        self.assertEqual(manager.text_buffer, "")
        self.assertEqual(manager.transcript_history, "")
        self.assertIsInstance(manager.text_buffer_size_threshold, int)
        self.assertIsInstance(manager.nodes_to_update, set)
        
        print("✓ Constructor API documented: ContextualTreeManager(decision_tree)")
    
    def test_primary_method_api_pattern(self):
        """Document: Primary method used across codebase"""
        # Pattern found: await tree_manager.process_voice_input(transcript)
        
        # This is an async method - all usage is awaited
        import asyncio
        
        async def test_async():
            await self.manager.process_voice_input("Test input")
            
        # Verify method exists and is callable
        self.assertTrue(hasattr(self.manager, 'process_voice_input'))
        self.assertTrue(callable(getattr(self.manager, 'process_voice_input')))
        
        # Run the async test  
        asyncio.run(test_async())
        
        print("✓ Primary API documented: await process_voice_input(transcribed_text)")
    
    def test_internal_state_access_patterns(self):
        """Document: How internal state is accessed (if at all)"""
        # These attributes are accessed in tests and usage
        
        # Text buffering state
        self.assertIsInstance(self.manager.text_buffer, str)
        self.assertIsInstance(self.manager.transcript_history, str)
        self.assertIsInstance(self.manager.text_buffer_size_threshold, int)
        
        # Update tracking
        self.assertIsInstance(self.manager.nodes_to_update, set)
        
        # LLM components
        self.assertIsNotNone(self.manager.summarizer)
        self.assertIsNotNone(self.manager.decider)
        self.assertIsNotNone(self.manager.rewriter)
        
        print("✓ Internal state documented: buffering, tracking, LLM components")
    
    def test_common_usage_pattern_from_codebase(self):
        """Document: The actual usage pattern found in 10+ files"""
        # This is the exact pattern found across the codebase:
        
        decision_tree = DecisionTree()
        tree_manager = ContextualTreeManager(decision_tree=decision_tree)
        
        # Then typically:
        # await tree_manager.process_voice_input(transcript)
        
        self.assertIsNotNone(tree_manager)
        self.assertIs(tree_manager.decision_tree, decision_tree)
        
        print("✓ Common usage pattern documented")
        
    def test_api_surface_analysis(self):
        """Document: Complete API surface of ContextualTreeManager"""
        api_methods = [method for method in dir(self.manager) 
                      if not method.startswith('_') and callable(getattr(self.manager, method))]
        
        api_attributes = [attr for attr in dir(self.manager)
                         if not attr.startswith('_') and not callable(getattr(self.manager, attr))]
        
        print(f"✓ Public methods: {api_methods}")
        print(f"✓ Public attributes: {api_attributes}")
        
        # Key finding: Only ONE public method!
        self.assertEqual(len(api_methods), 1)
        self.assertEqual(api_methods[0], 'process_voice_input')
        
        print("✓ API surface analysis: Single primary method interface")


# Analysis Results Summary
class AnalysisResults:
    """
    Day 1 Analysis Results: ContextualTreeManager Usage Patterns
    
    Key Findings:
    1. Constructor: ContextualTreeManager(decision_tree=DecisionTree)  
    2. Primary Method: await process_voice_input(transcribed_text: str)
    3. Usage Pattern: Simple - construct, then call primary method
    4. Files Using: 10+ files across tests and pipeline components
    5. API Surface: Minimal - single public method
    
    Interface Extraction Candidates (for Day 2):
    - process_voice_input(text: str) -> async method
    - decision_tree: DecisionTree -> required dependency
    - Constructor pattern: (decision_tree: DecisionTree)
    
    This simple interface makes consolidation easier!
    """
    
    USAGE_LOCATIONS = [
        "backend/pipeline_system_tests/test_audio_processing.py",
        "backend/pipeline_system_tests/test_full_system_integration.py", 
        "backend/tests/unit_tests/test_contextual_tree_manager.py",
        "backend/tests/integration_tests/test_audio_processing.py",
        "backend/tests/integration_tests/test_full_system_integration.py"
    ]
    
    COMMON_PATTERN = """
    # Standard usage pattern found in 10+ files:
    decision_tree = DecisionTree()
    tree_manager = ContextualTreeManager(decision_tree=decision_tree)
    await tree_manager.process_voice_input(transcript)
    """


if __name__ == '__main__':
    unittest.main() 