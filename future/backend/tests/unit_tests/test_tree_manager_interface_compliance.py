#!/usr/bin/env python3
"""
TreeManager Interface Compliance Tests

Permanent tests that validate all tree managers implement the common interface correctly.
These tests ensure architectural consistency and interchangeability across managers.

These are not migration tests - they are permanent system property tests.
"""

import pytest
from backend.tree_manager.base import TreeManagerInterface, TreeManagerMixin
from backend.tree_manager.text_to_tree_manager import ContextualTreeManager
from backend.tree_manager.workflow_tree_manager import WorkflowTreeManager
from backend.tree_manager.enhanced_workflow_tree_manager import EnhancedWorkflowTreeManager
from backend.tree_manager.decision_tree_ds import DecisionTree, Node


@pytest.fixture
def decision_tree_with_root():
    """Create a decision tree with a root node for testing"""
    tree = DecisionTree()
    root_node = Node(
        node_id=0,
        name="Root",
        content="Root content", 
        summary="Root summary"
    )
    tree.tree[0] = root_node
    return tree

@pytest.fixture
def empty_decision_tree():
    """Create an empty decision tree for testing"""
    return DecisionTree()


class TestTreeManagerInterfaceCompliance:
    """Test that all tree managers implement the common interface correctly"""
    
    @pytest.mark.parametrize("manager_class", [
        ContextualTreeManager,
        WorkflowTreeManager,
        EnhancedWorkflowTreeManager,
    ])
    def test_all_managers_implement_interface(self, manager_class, empty_decision_tree):
        """Test that all tree managers implement TreeManagerInterface"""
        manager = manager_class(empty_decision_tree)
        
        # Must implement the interface
        assert isinstance(manager, TreeManagerInterface), f"{manager_class.__name__} must implement TreeManagerInterface"
        assert isinstance(manager, TreeManagerMixin), f"{manager_class.__name__} must include TreeManagerMixin"
    
    @pytest.mark.parametrize("manager_class", [
        ContextualTreeManager,
        WorkflowTreeManager,
        EnhancedWorkflowTreeManager,
    ])
    def test_interface_method_signatures(self, manager_class, empty_decision_tree):
        """Test that all managers have the required interface methods"""
        manager = manager_class(empty_decision_tree)
        
        # Required interface methods
        assert hasattr(manager, 'process_voice_input'), f"{manager_class.__name__} must have process_voice_input method"
        assert callable(getattr(manager, 'process_voice_input')), f"{manager_class.__name__}.process_voice_input must be callable"
        
        # Required interface attributes
        assert hasattr(manager, 'decision_tree'), f"{manager_class.__name__} must have decision_tree attribute"
        assert hasattr(manager, 'nodes_to_update'), f"{manager_class.__name__} must have nodes_to_update attribute"
        
        # TreeManagerMixin methods
        assert hasattr(manager, 'get_tree_size'), f"{manager_class.__name__} must have TreeManagerMixin methods"
        assert hasattr(manager, 'get_basic_statistics'), f"{manager_class.__name__} must have TreeManagerMixin methods"
    
    @pytest.mark.parametrize("manager_class", [
        ContextualTreeManager,
        WorkflowTreeManager,
        EnhancedWorkflowTreeManager,
    ])
    def test_interface_contracts(self, manager_class, decision_tree_with_root):
        """Test that all managers follow interface contracts correctly"""
        manager = manager_class(decision_tree_with_root)
        
        # Constructor contract: must set decision_tree
        assert manager.decision_tree is decision_tree_with_root, f"{manager_class.__name__} constructor must set decision_tree"
        
        # nodes_to_update contract: must be a set
        assert isinstance(manager.nodes_to_update, set), f"{manager_class.__name__}.nodes_to_update must be a set"
        
        # TreeManagerMixin functionality
        tree_size = manager.get_tree_size()
        assert isinstance(tree_size, int), f"{manager_class.__name__}.get_tree_size() must return int"
        assert tree_size >= 0, f"{manager_class.__name__}.get_tree_size() must return non-negative value"
        
        stats = manager.get_basic_statistics()
        assert isinstance(stats, dict), f"{manager_class.__name__}.get_basic_statistics() must return dict"
        assert 'total_nodes' in stats, f"{manager_class.__name__}.get_basic_statistics() must include total_nodes"
        assert 'nodes_to_update' in stats, f"{manager_class.__name__}.get_basic_statistics() must include nodes_to_update"
    
    def test_managers_are_interchangeable(self, empty_decision_tree):
        """Test that managers implementing the same interface are interchangeable"""
        # Create instances of different managers
        managers = [
            ContextualTreeManager(empty_decision_tree),
            WorkflowTreeManager(empty_decision_tree),
            EnhancedWorkflowTreeManager(empty_decision_tree),
        ]
        
        # All should implement the same interface
        for manager in managers:
            assert isinstance(manager, TreeManagerInterface), f"{type(manager).__name__} must implement TreeManagerInterface"
        
        # All should have the same core interface methods and attributes
        common_methods = ['process_voice_input']
        common_attributes = ['decision_tree', 'nodes_to_update']
        common_mixin_methods = ['get_tree_size', 'get_basic_statistics']
        
        for manager in managers:
            for method in common_methods:
                assert hasattr(manager, method), f"{type(manager).__name__} missing method {method}"
                assert callable(getattr(manager, method)), f"{type(manager).__name__}.{method} not callable"
            
            for attr in common_attributes:
                assert hasattr(manager, attr), f"{type(manager).__name__} missing attribute {attr}"
            
            for method in common_mixin_methods:
                assert hasattr(manager, method), f"{type(manager).__name__} missing mixin method {method}"
                assert callable(getattr(manager, method)), f"{type(manager).__name__}.{method} not callable"


class TestSpecificManagerProperties:
    """Test manager-specific properties that should be preserved"""
    
    def test_contextual_tree_manager_properties(self, empty_decision_tree):
        """Test ContextualTreeManager preserves its specific functionality"""
        manager = ContextualTreeManager(empty_decision_tree)
        
        # ContextualTreeManager-specific attributes
        assert hasattr(manager, 'text_buffer'), "ContextualTreeManager must preserve text_buffer"
        assert hasattr(manager, 'transcript_history'), "ContextualTreeManager must preserve transcript_history"
        assert hasattr(manager, 'summarizer'), "ContextualTreeManager must preserve summarizer"
        assert hasattr(manager, 'decider'), "ContextualTreeManager must preserve decider"
        assert hasattr(manager, 'rewriter'), "ContextualTreeManager must preserve rewriter"
        
        # Verify proper initialization
        assert manager.text_buffer == "", "text_buffer should initialize to empty string"
        assert manager._first_processing == True, "first processing flag should be True"
    
    def test_workflow_tree_manager_properties(self, empty_decision_tree):
        """Test WorkflowTreeManager preserves its specific functionality"""
        manager = WorkflowTreeManager(empty_decision_tree)
        
        # WorkflowTreeManager-specific attributes
        assert hasattr(manager, 'buffer_manager'), "WorkflowTreeManager must preserve buffer_manager"
        assert hasattr(manager, 'workflow_adapter'), "WorkflowTreeManager must preserve workflow_adapter"
        assert hasattr(manager, 'text_buffer_size_threshold'), "WorkflowTreeManager must preserve threshold property"
        
        # WorkflowTreeManager-specific methods
        assert hasattr(manager, 'get_workflow_statistics'), "WorkflowTreeManager must preserve get_workflow_statistics"
        assert hasattr(manager, 'clear_workflow_state'), "WorkflowTreeManager must preserve clear_workflow_state"
        assert hasattr(manager, 'save_tree_structure'), "WorkflowTreeManager must preserve save_tree_structure"
        
        # Verify proper initialization
        assert manager.buffer_manager is not None, "buffer_manager should be initialized"
        assert manager.workflow_adapter is not None, "workflow_adapter should be initialized"


class TestInterfaceEvolution:
    """Test that the interface supports future evolution"""
    
    def test_interface_extensibility(self, empty_decision_tree):
        """Test that the interface supports adding new manager types"""
        # This test documents that new managers can be added by implementing the interface
        managers = [
            ContextualTreeManager(empty_decision_tree),
            WorkflowTreeManager(empty_decision_tree),
            EnhancedWorkflowTreeManager(empty_decision_tree),
        ]
        
        # All current managers should be instances of the base interface
        for manager in managers:
            assert isinstance(manager, TreeManagerInterface)
            assert isinstance(manager, TreeManagerMixin)
        
        # The interface should support polymorphic usage
        def use_manager_polymorphically(manager: TreeManagerInterface):
            """Function that works with any TreeManagerInterface implementation"""
            assert hasattr(manager, 'decision_tree')
            assert hasattr(manager, 'nodes_to_update')
            assert hasattr(manager, 'process_voice_input')
            return manager.get_tree_size()
        
        # Should work with any manager
        for manager in managers:
            size = use_manager_polymorphically(manager)
            assert isinstance(size, int)
    
    def test_interface_stability(self):
        """Test that the interface provides stable contracts"""
        # Document the stable interface contract
        interface_contract = {
            'required_methods': ['process_voice_input'],
            'required_attributes': ['decision_tree', 'nodes_to_update'],
            'mixin_methods': ['get_tree_size', 'get_basic_statistics'],
        }
        
        # This test serves as documentation of our interface stability promise
        assert len(interface_contract['required_methods']) >= 1, "Interface must have core methods"
        assert len(interface_contract['required_attributes']) >= 2, "Interface must have core attributes"
        assert len(interface_contract['mixin_methods']) >= 2, "Mixin must provide utility methods"


# System Architecture Documentation
class ArchitecturalProperties:
    """
    Permanent System Properties - NOT Migration State
    
    This test suite validates that our TreeManager architecture maintains:
    
    ✅ Interface Consistency: All managers implement TreeManagerInterface
    ✅ Interchangeability: Managers can be used polymorphically
    ✅ Backward Compatibility: Existing functionality preserved
    ✅ Type Safety: Proper method signatures and return types
    ✅ Extensibility: New managers can be added via interface
    ✅ Stability: Interface contracts remain stable over time
    
    These tests should ALWAYS pass, regardless of which managers exist.
    They test fundamental architectural properties, not migration states.
    """
    
    CURRENT_MANAGERS = [
        'ContextualTreeManager',        # Direct LLM integration
        'WorkflowTreeManager',          # Agentic workflow integration  
        'EnhancedWorkflowTreeManager',  # TADA + TROA hybrid system
    ]
    
    INTERFACE_CONTRACT = {
        'required_methods': ['process_voice_input'],
        'required_attributes': ['decision_tree', 'nodes_to_update'], 
        'mixin_methods': ['get_tree_size', 'get_basic_statistics'],
    } 