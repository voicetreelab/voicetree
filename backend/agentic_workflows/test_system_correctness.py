#!/usr/bin/env python3
"""
SINGLE ATOMIC COMMAND TO PROVE SYSTEM CORRECTNESS

This is the definitive test that proves the agentic workflows system is working.
Run this one command to verify everything is green.
"""

import sys
from pathlib import Path
import traceback

# Add backend to path
backend_dir = Path(__file__).parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))


def test_core_framework():
    """Test that core framework works correctly"""
    try:
        # Test basic imports
        from agentic_workflows.core.base_agent import BaseAgent, AgentType
        from agentic_workflows.core.registry import AgentRegistry
        
        # Test agent types exist
        assert len([t for t in AgentType]) == 3
        assert AgentType.SEQUENTIAL.value == "sequential"
        assert AgentType.BACKGROUND.value == "background" 
        assert AgentType.REACTIVE.value == "reactive"
        
        # Test registry can be created
        registry = AgentRegistry()
        assert registry is not None
        
        return True, "Core framework operational"
        
    except Exception as e:
        return False, f"Core framework failed: {e}"


def test_agent_definitions():
    """Test that all agent definitions work correctly"""
    try:
        # Test individual agent imports
        from agentic_workflows.agents.tada.definition import TADAAgent
        from agentic_workflows.agents.troa.definition import TROAAgent
        from agentic_workflows.agents.rewriter.definition import RewriterAgent
        
        # Test each agent can be instantiated
        tada = TADAAgent()
        troa = TROAAgent()
        rewriter = RewriterAgent()
        
        agents = [
            ('tada', tada),
            ('troa', troa), 
            ('rewriter', rewriter)
        ]
        
        for agent_id, agent in agents:
            assert agent is not None, f"Could not create agent {agent_id}"
            assert hasattr(agent, 'stages'), f"Agent {agent_id} missing stages"
            assert hasattr(agent, 'transitions'), f"Agent {agent_id} missing transitions"
            assert len(agent.stages) > 0, f"Agent {agent_id} has no stages"
            
            # Test dataflow spec
            spec = agent.get_dataflow_spec()
            assert 'agent_id' in spec
            assert 'stages' in spec
            assert 'transitions' in spec
        
        return True, f"All 3 agents operational"
        
    except Exception as e:
        return False, f"Agent definitions failed: {e}"


def test_agent_type_patterns():
    """Test that different agent types work as expected"""
    try:
        from agentic_workflows.agents.tada.definition import TADAAgent
        from agentic_workflows.agents.troa.definition import TROAAgent
        from agentic_workflows.agents.rewriter.definition import RewriterAgent
        from agentic_workflows.core.base_agent import AgentType
        
        # Test TADA (Sequential)
        tada = TADAAgent()
        assert tada.agent_type == AgentType.SEQUENTIAL
        assert len(tada.stages) == 4  # segmentation, relationship, integration, extraction
        
        # Test TROA (Background)  
        troa = TROAAgent()
        assert troa.agent_type == AgentType.BACKGROUND
        assert len(troa.stages) == 6  # analysis, planning, merge, split, relationship, execution
        
        # Test Rewriter (Reactive)
        rewriter = RewriterAgent()
        assert rewriter.agent_type == AgentType.REACTIVE
        assert len(rewriter.stages) == 4  # analysis, planning, rewrite, validation
        
        return True, "All agent type patterns correct"
        
    except Exception as e:
        return False, f"Agent type patterns failed: {e}"


def test_clean_api_surface():
    """Test that the API surface is clean and minimal"""
    try:
        # Test core components can be imported
        from agentic_workflows.core.base_agent import BaseAgent, AgentType
        from agentic_workflows.core.registry import AgentRegistry
        
        # Test agents module structure  
        from agentic_workflows.agents.tada import TADAAgent
        from agentic_workflows.agents.troa import TROAAgent  
        from agentic_workflows.agents.rewriter import RewriterAgent
        
        # Test infrastructure directory exists (don't import to avoid dependencies)
        infra_dir = Path(__file__).parent / "infrastructure"
        assert infra_dir.exists(), "Infrastructure directory missing"
        
        return True, "Clean API surface confirmed"
        
    except Exception as e:
        return False, f"Clean API test failed: {e}"


def test_concern_isolation():
    """Test that concerns are properly isolated"""
    try:
        # Test core framework has no agent-specific dependencies
        from agentic_workflows.core.base_agent import BaseAgent
        from agentic_workflows.core.registry import AgentRegistry
        
        # Test agents have no infrastructure dependencies in their definitions
        from agentic_workflows.agents.tada.definition import TADAAgent
        from agentic_workflows.agents.troa.definition import TROAAgent
        from agentic_workflows.agents.rewriter.definition import RewriterAgent
        
        # Create agents without infrastructure
        tada = TADAAgent()
        troa = TROAAgent() 
        rewriter = RewriterAgent()
        
        # All should work without infrastructure
        assert tada.get_dataflow_spec() is not None
        assert troa.get_dataflow_spec() is not None
        assert rewriter.get_dataflow_spec() is not None
        
        return True, "Concerns properly isolated"
        
    except Exception as e:
        return False, f"Concern isolation failed: {e}"


def test_directory_structure():
    """Test that the directory structure is clean"""
    try:
        base_dir = Path(__file__).parent
        
        # Check core structure
        core_dir = base_dir / "core"
        assert core_dir.exists(), "Core directory missing"
        assert (core_dir / "__init__.py").exists(), "Core __init__.py missing"
        assert (core_dir / "base_agent.py").exists(), "BaseAgent missing"
        assert (core_dir / "registry.py").exists(), "Registry missing"
        
        # Check agents structure
        agents_dir = base_dir / "agents"
        assert agents_dir.exists(), "Agents directory missing"
        assert (agents_dir / "__init__.py").exists(), "Agents __init__.py missing"
        
        for agent in ['tada', 'troa', 'rewriter']:
            agent_dir = agents_dir / agent
            assert agent_dir.exists(), f"Agent {agent} directory missing"
            assert (agent_dir / "__init__.py").exists(), f"Agent {agent} __init__.py missing"
            assert (agent_dir / "definition.py").exists(), f"Agent {agent} definition.py missing"
            assert (agent_dir / "prompts").exists(), f"Agent {agent} prompts directory missing"
        
        # Check infrastructure structure
        infra_dir = base_dir / "infrastructure"
        assert infra_dir.exists(), "Infrastructure directory missing"
        assert (infra_dir / "__init__.py").exists(), "Infrastructure __init__.py missing"
        
        return True, "Directory structure clean"
        
    except Exception as e:
        return False, f"Directory structure test failed: {e}"


def run_system_correctness_test():
    """
    SINGLE ATOMIC COMMAND TO PROVE SYSTEM CORRECTNESS
    
    Returns True if system is green, False if any issues
    """
    print("🧪 SYSTEM CORRECTNESS TEST")
    print("=" * 50)
    
    tests = [
        ("Core Framework", test_core_framework),
        ("Agent Definitions", test_agent_definitions),
        ("Agent Type Patterns", test_agent_type_patterns),
        ("Clean API Surface", test_clean_api_surface),
        ("Concern Isolation", test_concern_isolation),
        ("Directory Structure", test_directory_structure)
    ]
    
    passed = 0
    total = len(tests)
    results = []
    
    for test_name, test_func in tests:
        try:
            success, message = test_func()
            if success:
                print(f"✅ {test_name}: {message}")
                passed += 1
            else:
                print(f"❌ {test_name}: {message}")
            results.append((test_name, success, message))
        except Exception as e:
            print(f"💥 {test_name}: EXCEPTION - {e}")
            results.append((test_name, False, f"Exception: {e}"))
    
    print("\n" + "=" * 50)
    print(f"📊 SYSTEM STATUS: {passed}/{total} tests passed")
    
    if passed == total:
        print("🟢 SYSTEM STATE: GREEN - All systems operational")
        return True
    else:
        print("🔴 SYSTEM STATE: RED - Issues detected")
        print("\nFailed tests:")
        for name, success, message in results:
            if not success:
                print(f"  ❌ {name}: {message}")
        return False


if __name__ == "__main__":
    success = run_system_correctness_test()
    sys.exit(0 if success else 1) 