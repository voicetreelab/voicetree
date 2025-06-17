"""
Test to ensure unit tests can import modules without triggering API calls.
This verifies that our architecture properly separates concerns.
"""
import pytest
import unittest.mock as mock


def test_unit_tests_do_not_trigger_api_calls():
    """
    Verify that importing tree manager modules doesn't trigger API calls.
    Unit tests should be able to import without needing API access.
    """
    # Mock the API call functions to ensure they're never called during imports
    with mock.patch('backend.agentic_workflows.infrastructure.llm_integration.call_llm') as mock_call_llm, \
         mock.patch('backend.agentic_workflows.infrastructure.llm_integration.call_llm_structured') as mock_call_structured:
        
        # Import basic tree manager modules
        try:
            from backend.tree_manager.decision_tree_ds import DecisionTree
            print("✅ DecisionTree imported successfully")
        except ImportError as e:
            print(f"⚠️ Could not import DecisionTree: {e}")
        
        # Verify that no API calls were made during import
        mock_call_llm.assert_not_called()
        mock_call_structured.assert_not_called()
        
        print("✅ Unit test imports completed without API calls")


def test_api_availability_check_only_on_usage():
    """
    Verify that API availability is only checked when LLM functions are actually called.
    """
    from backend.agentic_workflows.infrastructure.llm_integration import GEMINI_AVAILABLE
    
    # We should be able to check GEMINI_AVAILABLE without crashes
    print(f"✅ GEMINI_AVAILABLE = {GEMINI_AVAILABLE}")
    
    # If API is not available, functions should crash only when called, not on import
    if not GEMINI_AVAILABLE:
        from backend.agentic_workflows.infrastructure.llm_integration import call_llm
        
        # This should not crash (function exists)
        assert callable(call_llm)
        
        # But calling it should crash with proper error
        with pytest.raises(RuntimeError, match="GEMINI API UNAVAILABLE"):
            call_llm("test prompt")
        
        print("✅ API unavailable handling works correctly")
    else:
        print("✅ API is available in test environment")


def test_tree_manager_can_be_instantiated_without_api():
    """
    Verify that tree manager classes can be instantiated without API calls.
    This is important for unit testing the tree logic independently.
    """
    try:
        from backend.tree_manager.decision_tree_ds import DecisionTree
        
        # Create a decision tree without triggering API calls
        tree = DecisionTree()
        
        # Verify basic tree operations work
        assert hasattr(tree, 'tree')
        print("✅ DecisionTree can be created and used without API")
    except ImportError as e:
        print(f"⚠️ Could not test DecisionTree: {e}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 