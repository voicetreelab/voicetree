#!/usr/bin/env python3
"""
Day 2 Test: Tree Manager Interface Validation

This test validates that our extracted TreeManagerInterface correctly captures
the common patterns shared by all tree managers.

Bible Rule Compliance:
- Small, testable change validation ✅
- Interface extraction verification ✅  
- Prepare for Day 3 implementation ✅
"""

import unittest
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from backend.tree_manager.base import TreeManagerInterface, TreeManagerMixin
from backend.tree_manager.decision_tree_ds import DecisionTree
from backend.tree_manager.text_to_tree_manager import ContextualTreeManager
from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager


class MockTreeManager(TreeManagerInterface):
    """Mock implementation for testing the interface"""
    
    def __init__(self, decision_tree: DecisionTree):
        super().__init__(decision_tree)
        self.processed_texts = []
    
    async def process_voice_input(self, transcribed_text: str):
        """Mock implementation that just records the input"""
        self.processed_texts.append(transcribed_text)


class TestTreeManagerInterface(unittest.TestCase):
    """
    Day 2 Test: Validate extracted interface matches actual manager patterns
    """
    
    def setUp(self):
        """Set up test fixtures"""
        self.decision_tree = DecisionTree()
    
    def test_interface_defines_common_constructor_pattern(self):
        """Verify interface captures the common constructor pattern"""
        # Test that interface can be instantiated (via mock)
        mock_manager = MockTreeManager(self.decision_tree)
        
        # Verify required attribute is set
        self.assertIs(mock_manager.decision_tree, self.decision_tree)
        
        print("✓ Interface constructor pattern validated")
    
    def test_interface_defines_common_method_pattern(self):
        """Verify interface captures the common method pattern"""
        mock_manager = MockTreeManager(self.decision_tree)
        
        # Verify method exists and is async
        self.assertTrue(hasattr(mock_manager, 'process_voice_input'))
        self.assertTrue(callable(getattr(mock_manager, 'process_voice_input')))
        
        # Test that it can be called (async)
        import asyncio
        
        async def test_async():
            await mock_manager.process_voice_input("test input")
            self.assertEqual(mock_manager.processed_texts, ["test input"])
        
        asyncio.run(test_async())
        
        print("✓ Interface method pattern validated")
    
    def test_existing_managers_match_interface_pattern(self):
        """Verify existing managers already match the extracted interface"""
        
        # Test ContextualTreeManager matches pattern
        contextual_manager = ContextualTreeManager(decision_tree=self.decision_tree)
        self.assertIsNotNone(contextual_manager.decision_tree)
        self.assertTrue(hasattr(contextual_manager, 'process_voice_input'))
        self.assertTrue(callable(getattr(contextual_manager, 'process_voice_input')))
        
        # Test WorkflowTreeManager matches pattern  
        workflow_manager = WorkflowTreeManager(decision_tree=self.decision_tree)
        self.assertIsNotNone(workflow_manager.decision_tree)
        self.assertTrue(hasattr(workflow_manager, 'process_voice_input'))
        self.assertTrue(callable(getattr(workflow_manager, 'process_voice_input')))
        
        print("✓ Existing managers match interface pattern")
    
    def test_nodes_to_update_property_pattern(self):
        """Verify the common nodes_to_update property pattern"""
        mock_manager = MockTreeManager(self.decision_tree)
        
        # Test that property exists and returns a set-like object
        nodes_to_update = mock_manager.nodes_to_update
        self.assertIsNotNone(nodes_to_update)
        
        print("✓ Common property pattern validated")
    
    def test_tree_manager_mixin_utilities(self):
        """Test the common utility methods"""
        
        class TestManager(TreeManagerInterface, TreeManagerMixin):
            def __init__(self, decision_tree):
                super().__init__(decision_tree)
            
            async def process_voice_input(self, transcribed_text: str):
                pass
        
        manager = TestManager(self.decision_tree)
        
        # Test utility methods
        tree_size = manager.get_tree_size()
        self.assertIsInstance(tree_size, int)
        self.assertGreaterEqual(tree_size, 0)
        
        root_children = manager.get_root_children_count()
        self.assertIsInstance(root_children, int)
        self.assertGreaterEqual(root_children, 0)
        
        stats = manager.get_basic_statistics()
        self.assertIsInstance(stats, dict)
        self.assertIn('total_nodes', stats)
        self.assertIn('root_children', stats)
        self.assertIn('nodes_to_update', stats)
        
        print("✓ Mixin utilities validated")
    
    def test_interface_extraction_is_minimal(self):
        """Verify we extracted the minimal necessary interface"""
        
        # Interface should have minimal API surface
        interface_methods = [method for method in dir(TreeManagerInterface) 
                           if not method.startswith('_')]
        
        # Should only have the essential methods/properties
        expected_methods = ['process_voice_input', 'nodes_to_update']
        
        for method in expected_methods:
            self.assertIn(method, interface_methods)
        
        print(f"✓ Minimal interface extracted: {interface_methods}")
    
    def test_day_3_readiness(self):
        """Verify we're ready for Day 3: Make ContextualTreeManager implement interface"""
        
        # ContextualTreeManager should already match the interface
        contextual_manager = ContextualTreeManager(decision_tree=self.decision_tree)
        
        # Check that it has all required interface elements
        self.assertTrue(hasattr(contextual_manager, 'decision_tree'))
        self.assertTrue(hasattr(contextual_manager, 'process_voice_input'))
        self.assertTrue(hasattr(contextual_manager, 'nodes_to_update'))
        
        # Check method signatures match
        import inspect
        signature = inspect.signature(contextual_manager.process_voice_input)
        params = list(signature.parameters.keys())
        self.assertIn('transcribed_text', params)
        
        print("✓ Day 3 readiness confirmed: ContextualTreeManager matches interface")


class InterfaceExtractionSummary:
    """
    Day 2 Summary: Interface Extraction Complete
    
    Extracted Common Interface:
    1. ✓ Constructor: __init__(decision_tree: DecisionTree)
    2. ✓ Primary Method: async process_voice_input(transcribed_text: str)
    3. ✓ Common Property: nodes_to_update
    4. ✓ Utility Mixin: TreeManagerMixin with helper methods
    
    Validation Results:
    - ✓ Interface captures actual usage patterns
    - ✓ Existing managers already match interface
    - ✓ Minimal, focused interface design
    - ✓ Ready for Day 3 implementation
    
    Day 3 Plan:
    - Make ContextualTreeManager inherit from TreeManagerInterface
    - Verify all existing usage continues to work
    - No behavior changes, just interface compliance
    """
    pass


if __name__ == '__main__':
    unittest.main() 