"""
Agent Registry - Multi-Agent Management

Provides a clean API for registering, discovering, and managing multiple agents.
Hides the complexity of agent instantiation and lifecycle management.
"""

from typing import Dict, List, Optional, Type, Any
from .base_agent import BaseAgent, AgentType
import logging


class AgentRegistry:
    """
    Central registry for managing multiple agents
    
    Provides a clean API for agent registration, discovery, and instantiation.
    """
    
    def __init__(self):
        """Initialize the agent registry"""
        self._agent_classes: Dict[str, Type[BaseAgent]] = {}
        self._agent_instances: Dict[str, BaseAgent] = {}
        self._agent_metadata: Dict[str, Dict[str, Any]] = {}
    
    def register_agent_class(
        self, 
        agent_id: str, 
        agent_class: Type[BaseAgent],
        metadata: Optional[Dict[str, Any]] = None
    ):
        """
        Register an agent class
        
        Args:
            agent_id: Unique identifier for the agent
            agent_class: The agent class to register
            metadata: Optional metadata about the agent
        """
        if agent_id in self._agent_classes:
            logging.warning(f"Agent {agent_id} already registered, overwriting")
        
        self._agent_classes[agent_id] = agent_class
        self._agent_metadata[agent_id] = metadata or {}
        
        logging.info(f"Registered agent class: {agent_id}")
    
    def get_agent(self, agent_id: str, **kwargs) -> Optional[BaseAgent]:
        """
        Get an agent instance (singleton pattern)
        
        Args:
            agent_id: ID of the agent to get
            **kwargs: Arguments to pass to agent constructor
            
        Returns:
            Agent instance or None if not found
        """
        # Return existing instance if available
        if agent_id in self._agent_instances:
            return self._agent_instances[agent_id]
        
        # Create new instance if class is registered
        if agent_id in self._agent_classes:
            agent_class = self._agent_classes[agent_id]
            try:
                agent_instance = agent_class(**kwargs)
                self._agent_instances[agent_id] = agent_instance
                logging.info(f"Created agent instance: {agent_id}")
                return agent_instance
            except Exception as e:
                logging.error(f"Failed to create agent {agent_id}: {e}")
                return None
        
        logging.warning(f"Agent {agent_id} not found in registry")
        return None
    
    def list_agents(self) -> List[Dict[str, Any]]:
        """List all registered agents"""
        agents = []
        for agent_id, agent_class in self._agent_classes.items():
            metadata = self._agent_metadata.get(agent_id, {})
            is_instantiated = agent_id in self._agent_instances
            
            agents.append({
                "agent_id": agent_id,
                "agent_class": agent_class.__name__,
                "is_instantiated": is_instantiated,
                "metadata": metadata
            })
        
        return agents
    
    def get_agents_by_type(self, agent_type: AgentType) -> List[BaseAgent]:
        """Get all agents of a specific type"""
        agents = []
        for agent_id in self._agent_classes.keys():
            agent = self.get_agent(agent_id)
            if agent and agent.agent_type == agent_type:
                agents.append(agent)
        return agents
    
    def clear_instances(self):
        """Clear all agent instances (but keep registered classes)"""
        self._agent_instances.clear()
        logging.info("Cleared all agent instances")
    
    def unregister_agent(self, agent_id: str):
        """Unregister an agent completely"""
        if agent_id in self._agent_classes:
            del self._agent_classes[agent_id]
        if agent_id in self._agent_instances:
            del self._agent_instances[agent_id]
        if agent_id in self._agent_metadata:
            del self._agent_metadata[agent_id]
        
        logging.info(f"Unregistered agent: {agent_id}")
    
    def get_agent_info(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """Get information about a specific agent"""
        if agent_id not in self._agent_classes:
            return None
        
        agent_class = self._agent_classes[agent_id]
        metadata = self._agent_metadata.get(agent_id, {})
        is_instantiated = agent_id in self._agent_instances
        
        info = {
            "agent_id": agent_id,
            "agent_class": agent_class.__name__,
            "is_instantiated": is_instantiated,
            "metadata": metadata
        }
        
        # Add runtime info if instance exists
        if is_instantiated:
            agent = self._agent_instances[agent_id]
            info.update(agent.get_agent_info())
        
        return info


# Global registry instance
_global_registry = AgentRegistry()


# Convenience functions for global registry
def register_agent(agent_id: str, agent_class: Type[BaseAgent], metadata: Optional[Dict[str, Any]] = None):
    """Register an agent class globally"""
    _global_registry.register_agent_class(agent_id, agent_class, metadata)


def get_agent(agent_id: str, **kwargs) -> Optional[BaseAgent]:
    """Get an agent from the global registry"""
    return _global_registry.get_agent(agent_id, **kwargs)


def list_agents() -> List[Dict[str, Any]]:
    """List all agents in the global registry"""
    return _global_registry.list_agents()


def get_agents_by_type(agent_type: AgentType) -> List[BaseAgent]:
    """Get all agents of a specific type from the global registry"""
    return _global_registry.get_agents_by_type(agent_type)


def get_agent_info(agent_id: str) -> Optional[Dict[str, Any]]:
    """Get information about a specific agent"""
    return _global_registry.get_agent_info(agent_id)


def get_registry() -> AgentRegistry:
    """Get the global registry instance (for advanced usage)"""
    return _global_registry 