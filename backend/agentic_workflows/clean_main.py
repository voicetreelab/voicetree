"""
Clean VoiceTree Pipeline - Demonstrates Clean Architecture

This shows the clean separation between:
1. Agent definition (pure workflow specification)
2. Infrastructure (execution tools)

The agent is just nodes + edges + prompts.
The infrastructure handles execution, LLM calls, state management, etc.
"""

from typing import Dict, Any, Optional
from pathlib import Path

# Clean imports - agent definition separate from infrastructure
# from .agent import VoiceTreeAgent, get_agent_definition
# from .infrastructure import AgentExecutor, VoiceTreeStateManager


class CleanVoiceTreePipeline:
    """
    Clean pipeline demonstrating the separation of concerns
    
    The agent definition is pure (no infrastructure dependencies).
    The infrastructure handles all execution concerns.
    
    NOTE: This class is currently disabled due to missing dependencies.
    """
    
    def __init__(self, state_file: Optional[str] = None):
        """Initialize with clean architecture"""
        # DISABLED: Missing VoiceTreeAgent class
        # self.agent = VoiceTreeAgent()
        
        # DISABLED: Missing AgentExecutor class  
        # self.executor = AgentExecutor(self.agent)
        # self.state_manager = VoiceTreeStateManager(state_file) if state_file else None
        
        print("⚠️ CleanVoiceTreePipeline is currently disabled due to missing dependencies")
        self.agent = None
        self.executor = None
        self.state_manager = None
        
        print("🏗️ Clean VoiceTree Pipeline Initialized")
        print(f"   • Agent stages: {len(self.agent.stages)}")
        print(f"   • Agent transitions: {len(self.agent.transitions)}")
        print(f"   • State management: {'enabled' if self.state_manager else 'disabled'}")
    
    def run(self, transcript: str, existing_nodes: Optional[str] = None) -> Dict[str, Any]:
        """
        Run the pipeline using clean architecture
        
        Args:
            transcript: Input text to process
            existing_nodes: Context about existing nodes
            
        Returns:
            Processing results
        """
        print("\n🚀 Starting Clean Pipeline Execution")
        print("=" * 50)
        
        # Get existing nodes from state manager if available
        if existing_nodes is None and self.state_manager:
            existing_nodes = self.state_manager.get_node_summaries()
        
        if existing_nodes is None:
            existing_nodes = "No existing nodes"
        
        # Create initial state
        initial_state = {
            "transcript_text": transcript,
            "existing_nodes": existing_nodes,
            "chunks": None,
            "analyzed_chunks": None,
            "integration_decisions": None,
            "new_nodes": None,
            "current_stage": "start",
            "error_message": None
        }
        
        # Execute using clean architecture
        try:
            final_state = self.executor.execute(initial_state)
            
            print("\n✅ Clean Pipeline Completed")
            print("=" * 50)
            
            if final_state.get("error_message"):
                print(f"❌ Error: {final_state['error_message']}")
            else:
                self._print_results(final_state)
                
                # Update state if manager available
                if self.state_manager and final_state.get("new_nodes"):
                    self.state_manager.add_nodes(final_state["new_nodes"], final_state)
                    print(f"\n📊 State updated: {len(self.state_manager.nodes)} total nodes")
            
            return final_state
            
        except Exception as e:
            print(f"❌ Execution failed: {e}")
            return {
                **initial_state,
                "current_stage": "error",
                "error_message": str(e)
            }
    
    def inspect_agent(self) -> Dict[str, Any]:
        """Inspect the clean agent definition"""
        return self.agent.get_dataflow_spec()
    
    def get_execution_summary(self) -> Dict[str, Any]:
        """Get execution summary from infrastructure"""
        return self.executor.get_execution_summary()
    
    def visualize_workflow(self) -> str:
        """Generate workflow visualization"""
        dataflow = self.agent.get_dataflow_spec()
        
        mermaid = ["graph TD"]
        
        # Add stage nodes
        for stage in dataflow["stages"]:
            mermaid.append(f'    {stage["id"]}["{stage["name"]}<br/>{stage["description"]}"]')
        
        # Add transitions
        for transition in dataflow["transitions"]:
            if transition["to"] == "END":
                mermaid.append(f'    {transition["from"]} --> END[("End")]')
            else:
                if transition["condition"] == "success":
                    mermaid.append(f'    {transition["from"]} --> {transition["to"]}')
                else:
                    mermaid.append(f'    {transition["from"]} -.->|{transition["condition"]}| {transition["to"]}')
        
        return "\n".join(mermaid)
    
    def _print_results(self, state: Dict[str, Any]) -> None:
        """Print execution results"""
        print("📊 Results Summary:")
        print(f"   • Chunks: {len(state.get('chunks', []))}")
        print(f"   • Analyzed chunks: {len(state.get('analyzed_chunks', []))}")
        print(f"   • Integration decisions: {len(state.get('integration_decisions', []))}")
        print(f"   • New nodes: {len(state.get('new_nodes', []))}")
        
        if state.get("new_nodes"):
            print(f"   • Node names: {', '.join(state['new_nodes'])}")


def demonstrate_clean_architecture():
    """Demonstrate the clean architecture separation"""
    print("🏗️ VoiceTree Clean Architecture Demo")
    print("=" * 50)
    
    print("⚠️ Demo currently disabled due to missing dependencies:")
    print("   • Missing VoiceTreeAgent class")
    print("   • Missing AgentExecutor class")
    print("   • This appears to be a design prototype that needs implementation")
    
    # DISABLED: Missing VoiceTreeAgent class
    # agent = VoiceTreeAgent()
    # print(f"\n1. 📋 Pure Agent Definition:")
    # print(f"   • Stages: {len(agent.stages)}")
    # print(f"   • Transitions: {len(agent.transitions)}")
    # print(f"   • Prompts: {[s.prompt_file for s in agent.stages]}")
    
    # DISABLED: Missing AgentExecutor class
    # executor = AgentExecutor(agent)
    # print(f"\n2. ⚙️ Infrastructure:")
    # print(f"   • Executor ready: {executor is not None}")
    # print(f"   • Agent loaded: {executor.agent is not None}")
    
    print(f"\n🔄 Clean Architecture Concept:")
    print(f"   • Agent definition should be pure - no LLM calls, no state management")
    print(f"   • Infrastructure should handle execution - LLM calls, state, logging")
    print(f"   • Easy to test, modify, and understand each part independently")


def main():
    """Main entry point demonstrating clean architecture"""
    demonstrate_clean_architecture()
    
    print("\n" + "=" * 50)
    print("Ready to process transcripts with clean architecture!")
    print("Use CleanVoiceTreePipeline for production usage.")


if __name__ == "__main__":
    main() 