"""
Graph definition for VoiceTree LangGraph workflow
Defines the flow between processing stages
"""

try:
    from langgraph.graph import StateGraph, END
    from state import VoiceTreeState
    from nodes import (
        segmentation_node,
        relationship_analysis_node, 
        integration_decision_node,
        node_extraction_node
    )
    LANGGRAPH_AVAILABLE = True
except ImportError:
    print("⚠️ LangGraph not available, using mock implementations")
    LANGGRAPH_AVAILABLE = False
    
    # Mock implementations for testing without LangGraph
    class StateGraph:
        def __init__(self, state_type): pass
        def add_node(self, name, func): pass
        def set_entry_point(self, name): pass
        def add_conditional_edges(self, source, condition, mapping): pass
        def compile(self): return MockApp()
    
    class MockApp:
        def invoke(self, state): 
            return {"error_message": "LangGraph not installed"}
    
    END = "END"
    VoiceTreeState = dict


def should_continue(state) -> str:
    """
    Conditional edge function to determine next step based on current stage
    """
    current_stage = state.get("current_stage", "")
    
    if current_stage == "error":
        return END
    elif current_stage == "segmentation_complete":
        return "relationship_analysis"
    elif current_stage == "relationship_analysis_complete":
        return "integration_decision"
    elif current_stage == "integration_decision_complete":
        return "node_extraction"
    elif current_stage == "complete":
        return END
    else:
        # Default: start with segmentation
        return "segmentation"


def create_voicetree_graph():
    """
    Create and configure the VoiceTree processing graph
    """
    if not LANGGRAPH_AVAILABLE:
        return StateGraph(dict)
    
    # Import nodes here to avoid circular imports
    from nodes import (
        segmentation_node,
        relationship_analysis_node, 
        integration_decision_node,
        node_extraction_node
    )
    
    # Create the state graph
    workflow = StateGraph(VoiceTreeState)
    
    # Add nodes for each processing stage
    workflow.add_node("segmentation", segmentation_node)
    workflow.add_node("relationship_analysis", relationship_analysis_node)
    workflow.add_node("integration_decision", integration_decision_node)
    workflow.add_node("node_extraction", node_extraction_node)
    
    # Set the entry point
    workflow.set_entry_point("segmentation")
    
    # Add conditional edges to control flow
    workflow.add_conditional_edges(
        "segmentation",
        should_continue,
        {
            "relationship_analysis": "relationship_analysis",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "relationship_analysis",
        should_continue,
        {
            "integration_decision": "integration_decision",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "integration_decision", 
        should_continue,
        {
            "node_extraction": "node_extraction",
            END: END
        }
    )
    
    workflow.add_conditional_edges(
        "node_extraction",
        should_continue,
        {
            END: END
        }
    )
    
    return workflow


def compile_voicetree_graph():
    """
    Compile the VoiceTree graph for execution
    """
    workflow = create_voicetree_graph()
    return workflow.compile() 